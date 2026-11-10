"""Med Med missed-dose checker.

Runs on a GitHub Actions schedule. Reads Yuki's shared log in Firestore and,
when a dose is about 20 minutes past due with nobody logging it, sends one
push notification to every phone that turned alerts on in Med Med.

Secrets (set in the repo's Settings > Secrets and variables > Actions):
  HOUSEHOLD_CODE     the family's household code from Med Med's Print tab
  VAPID_PRIVATE_KEY  the private half of the push key pair
The Firebase web keys are public and are read from firebase-config.js.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush

TZ = ZoneInfo("America/Toronto")
ROOT = Path(__file__).resolve().parent.parent
GRACE_MIN = 20          # alert this long after a dose is due
GIVE_UP_HOURS = 3       # stop alerting about a dose after this long
TOKEN_FILE = ROOT / ".alert-token"

# Keep in step with SLOTS in index.html. Bedtime (hour 24) is due at midnight
# but belongs to the previous day's row, same as the paper sheet.
SLOTS = [
    ("early", "Early", "8:00 AM", 8, "Pimobendan 7.5 mg and Diltiazem 60 mg"),
    ("late", "Late Morning", "10:00 AM", 10, "Furosemide 40 mg and Digoxin 0.0625 mg"),
    ("afternoon", "Afternoon", "4:00 PM", 16, "Pimobendan 7.5 mg and Diltiazem 60 mg"),
    ("evening", "Evening", "10:00 PM", 22, "Furosemide 40 mg and Digoxin 0.0625 mg"),
    ("bedtime", "Bedtime", "12:00 AM", 24, "Pimobendan 7.5 mg and Diltiazem 60 mg"),
]


def log(msg):
    print(msg, file=sys.stderr)


def firebase_config():
    text = (ROOT / "firebase-config.js").read_text()
    cfg = dict(re.findall(r'(\w+):\s*"([^"]*)"', text))
    return cfg["apiKey"], cfg["projectId"]


def http(method, url, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"error": raw.decode(errors="replace")}


def sign_in(api_key):
    """Signs in as the checker's anonymous user, reusing it between runs when the cache has it."""
    if TOKEN_FILE.exists():
        status, res = http("POST", f"https://securetoken.googleapis.com/v1/token?key={api_key}",
                           {"grant_type": "refresh_token", "refresh_token": TOKEN_FILE.read_text().strip()})
        if status == 200:
            TOKEN_FILE.write_text(res["refresh_token"])
            return res["id_token"]
        log("Saved sign-in expired, starting a new one")
    status, res = http("POST", f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}",
                       {"returnSecureToken": True})
    if status != 200:
        raise SystemExit(f"Firebase sign-in failed: {res}")
    TOKEN_FILE.write_text(res["refreshToken"])
    return res["idToken"]


class Store:
    def __init__(self, project, household, token):
        self.base = (f"https://firestore.googleapis.com/v1/projects/{project}"
                     f"/databases/(default)/documents/households/{household}")
        self.token = token

    def get(self, path):
        status, res = http("GET", f"{self.base}/{path}", token=self.token)
        if status == 404:
            return None
        if status != 200:
            raise SystemExit(f"Reading {path} failed: {res}")
        return res

    def list(self, coll):
        docs, page = [], ""
        while True:
            status, res = http("GET", f"{self.base}/{coll}?pageSize=300{page}", token=self.token)
            if status != 200:
                raise SystemExit(f"Reading {coll} failed: {res}")
            docs += res.get("documents", [])
            if not res.get("nextPageToken"):
                return docs
            page = f"&pageToken={res['nextPageToken']}"

    def create(self, coll, doc_id, fields):
        status, res = http("POST", f"{self.base}/{coll}?documentId={doc_id}",
                           {"fields": fields}, token=self.token)
        return status

    def delete(self, path):
        http("DELETE", f"{self.base}/{path}", token=self.token)


def plain(value):
    """Turns a Firestore REST value into plain Python."""
    if "mapValue" in value:
        return {k: plain(v) for k, v in value["mapValue"].get("fields", {}).items()}
    if "arrayValue" in value:
        return [plain(v) for v in value["arrayValue"].get("values", [])]
    for key in ("stringValue", "booleanValue", "integerValue", "doubleValue", "timestampValue"):
        if key in value:
            return value[key]
    return None


def due_doses(now):
    """Every dose whose alert window is open right now, as (log date, slot, due time)."""
    out = []
    for back in (0, 1):
        day = (now - dt.timedelta(days=back)).date()
        for slot in SLOTS:
            due = dt.datetime.combine(day, dt.time(0), TZ) + dt.timedelta(hours=slot[3])
            if due + dt.timedelta(minutes=GRACE_MIN) <= now < due + dt.timedelta(hours=GIVE_UP_HOURS):
                out.append((day.isoformat(), slot, due))
    return out


def main():
    household = os.environ.get("HOUSEHOLD_CODE", "").strip().upper()
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    dry_run = os.environ.get("DRY_RUN") == "1"
    if not re.fullmatch(r"[A-Z0-9]{4}(-[A-Z0-9]{4}){3}", household):
        raise SystemExit("HOUSEHOLD_CODE secret is missing or not in the ABCD-EFGH-JKLM-NPQR form")
    if not private_key and not dry_run:
        raise SystemExit("VAPID_PRIVATE_KEY secret is missing")

    now = dt.datetime.now(TZ)
    if os.environ.get("NOW"):
        now = dt.datetime.fromisoformat(os.environ["NOW"]).astimezone(TZ)
    candidates = due_doses(now)
    if not candidates:
        log(f"{now:%a %H:%M}: no dose is in its alert window")
        return

    api_key, project = firebase_config()
    store = Store(project, household, sign_in(api_key))

    missed = []
    for date, slot, due in candidates:
        doc = store.get(f"days/{date}")
        slots = plain({"mapValue": doc}).get("slots", {}) if doc else {}
        if slots.get(slot[0]):
            continue
        if store.get(f"alerts/{date}_{slot[0]}"):
            continue
        missed.append((date, slot, due))
    if not missed:
        log(f"{now:%a %H:%M}: every due dose is logged or already alerted")
        return

    subs = [plain({"mapValue": d}) | {"_name": d["name"]} for d in store.list("subs")]
    log(f"{len(missed)} missed dose(s), {len(subs)} phone(s) signed up for alerts")

    for date, (key, name, time_label, _, meds), due in missed:
        payload = json.dumps({
            "title": f"Yuki's {name} dose isn't logged",
            "body": f"Due at {time_label}: {meds}. Tap to log it if it's been given.",
            "tag": f"{date}_{key}",
            "url": "./#today",
        })
        if dry_run:
            log(f"[dry run] would alert: {payload}")
            continue
        # Claim the alert first so two overlapping runs can't both send it.
        if store.create("alerts", f"{date}_{key}", {"at": {"stringValue": now.isoformat()}}) not in (200, 201):
            log(f"{date} {key}: another run already sent this alert")
            continue
        sent = 0
        for sub in subs:
            try:
                webpush(
                    subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": "mailto:alerts@med-med.invalid"},
                    ttl=3 * 3600,
                )
                sent += 1
            except WebPushException as e:
                code = e.response.status_code if e.response is not None else None
                if code in (404, 410):
                    store.delete(sub["_name"].split(f"/households/{household}/", 1)[1])
                    log("Removed a phone that turned alerts off")
                else:
                    log(f"Push failed ({code}): {e}")
        log(f"{date} {key}: alerted {sent} phone(s)")


if __name__ == "__main__":
    main()
