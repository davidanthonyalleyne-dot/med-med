"""Med Med missed-dose checker.

Runs on a GitHub Actions schedule. Reads the pet's shared log in Firestore and,
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

    api_key, project = firebase_config()
    store = Store(project, household, sign_in(api_key))

    # Medicines added in the app, and the pet's name.
    meds, pet = {}, "Yuki"
    for d in store.list("meds"):
        key = d["name"].rsplit("/", 1)[1]
        meds[key] = plain({"mapValue": d})
    if (meds.get("pet") or {}).get("name"):
        pet = str(meds["pet"]["name"])[:24]
    added = {k: m for k, m in meds.items() if m.get("custom") == "yes" and m.get("stopped") != "yes"}

    def dose_text(m):
        n = float(m.get("dose") or 1)
        return m.get("strength", "") if n == 1 else f"{n:g} x {m.get('strength') or m.get('form', '')}"

    outgoing = []  # (marker id, log line, payload)

    # 1. Missed doses
    for date, slot, due in candidates:
        doc = store.get(f"days/{date}")
        slots = plain({"mapValue": doc}).get("slots", {}) if doc else {}
        if slots.get(slot[0]) or store.get(f"alerts/{date}_{slot[0]}"):
            continue
        key, name, time_label, _, meds_text = slot
        extra = [f"{m['name']} {dose_text(m)}".strip() for m in added.values() if key in str(m.get("slots", "")).split(",")]
        if extra:
            items = meds_text.split(" and ") + extra
            meds_text = ", ".join(items[:-1]) + " and " + items[-1]
        outgoing.append((f"{date}_{key}", f"{date} {key}", json.dumps({
            "title": f"{pet}'s {name} dose isn't logged",
            "body": f"Due at {time_label}: {meds_text}. Tap to log it if it's been given.",
            "tag": f"{date}_{key}",
            "url": "./#today",
        })))

    # 2. Newly added medicines, announced once (unless the person adding it turned that off)
    order = [s[0] for s in SLOTS]
    for key, m in added.items():
        if m.get("tell") == "no" or not m.get("added"):
            continue
        try:
            at = dt.datetime.fromisoformat(str(m["added"]).replace("Z", "+00:00")).astimezone(TZ)
        except ValueError:
            continue
        if not dt.timedelta(0) <= now - at <= dt.timedelta(hours=48):
            continue
        marker = f"{at:%Y-%m-%d}_new{key}"
        if store.get(f"alerts/{marker}"):
            continue
        keys = [k for k in order if k in str(m.get("slots", "")).split(",")]
        if not keys:
            continue
        times = [next(s[2] for s in SLOTS if s[0] == k).replace(":00", "") for k in keys]
        when = times[0] if len(times) == 1 else ", ".join(times[:-1]) + " and " + times[-1]
        freq = {1: "once a day", 2: "twice a day", 3: "three times a day"}.get(len(keys), f"{len(keys)} times a day")
        n = float(m.get("dose") or 1)
        unit = "ml" if m.get("form") == "ml" else (m.get("form") or "tablet")
        each = f"{n:g} {unit}{'s' if n > 1 and unit != 'ml' else ''}"
        body = f"{each} {freq}, at {when}."
        if m.get("purpose"):
            body += f" {m['purpose']}"
        if m.get("addedBy"):
            body += f" Added by {m['addedBy']}."
        outgoing.append((marker, f"new med {key}", json.dumps({
            "title": f"New med for {pet}: {m.get('name', key)} {m.get('strength', '')}".strip(),
            "body": body,
            "tag": marker,
            "url": "./#today",
        })))

    if not outgoing:
        log(f"{now:%a %H:%M}: nothing to alert")
        return

    subs = [plain({"mapValue": d}) | {"_name": d["name"]} for d in store.list("subs")]
    log(f"{len(outgoing)} alert(s), {len(subs)} phone(s) signed up for alerts")

    failed = []
    for marker, label, payload in outgoing:
        if dry_run:
            log(f"[dry run] would alert: {payload}")
            continue
        # Claim the alert first so two overlapping runs can't both send it.
        if store.create("alerts", marker, {"at": {"stringValue": now.isoformat()}}) not in (200, 201):
            log(f"{label}: another run already sent this alert")
            continue
        sent = 0
        for sub in subs:
            try:
                webpush(
                    subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": "mailto:alerts@davidanthonyalleyne-dot.github.io"},
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
        log(f"{label}: alerted {sent} phone(s)")
        if subs and not sent:
            failed.append(label)
    if failed:
        # Fail the run so GitHub emails the repo owner instead of failing silently.
        raise SystemExit(f"No phone received the alert for {', '.join(failed)}")


if __name__ == "__main__":
    main()
