"""Copies problem reports from David's apps out of Firestore into data/diag/<app>/.

The apps (Med Med, Puzz Puzz, PK, Curb, Emulator Desk) add entries to the "diag"
collection with diag.js. This runs on a GitHub Actions schedule, writes each entry
as a JSON file, deletes it from Firestore, and keeps the newest 60 files per app.
Entries hold errors, recent taps and screen details only, never app data.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_missed import firebase_config, http, log  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "diag"
KEEP = 60


TOKEN_FILE = ROOT / ".diag-token"


def sign_in(api_key):
    """Reuses the collector's anonymous sign-in between runs when the cache has it."""
    if TOKEN_FILE.exists():
        status, res = http("POST", f"https://securetoken.googleapis.com/v1/token?key={api_key}",
                           {"grant_type": "refresh_token", "refresh_token": TOKEN_FILE.read_text().strip()})
        if status == 200:
            TOKEN_FILE.write_text(res["refresh_token"])
            return res["id_token"]
    status, res = http("POST", f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}",
                       {"returnSecureToken": True})
    if status != 200:
        raise SystemExit(f"Sign-in failed: {status} {res}")
    TOKEN_FILE.write_text(res["refreshToken"])
    return res["idToken"]


def main():
    api_key, project = firebase_config()
    token = sign_in(api_key)
    base = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/diag"
    got, page = 0, ""
    while True:
        status, res = http("GET", f"{base}?pageSize=300" + (f"&pageToken={page}" if page else ""), token=token)
        if status == 403:
            log("Firestore refused the read. Publish the current firestore.rules in the Firebase console.")
            return
        if status != 200:
            raise SystemExit(f"Reading diag failed: {status} {res}")
        for doc in res.get("documents", []):
            f = {k: v.get("stringValue", "") for k, v in doc.get("fields", {}).items()}
            app = re.sub(r"[^a-z]", "", f.get("app", "")) or "unknown"
            entry = {"app": app, "at": f.get("at", ""), "kind": f.get("kind", ""), "msg": f.get("msg", "")}
            for k in ("state", "crumbs"):
                try:
                    entry[k] = json.loads(f.get(k) or "null")
                except ValueError:
                    entry[k] = f.get(k)
            stamp = re.sub(r"[^0-9T]", "", entry["at"])[:15] or "0"
            path = OUT / app / f"{stamp}-{doc['name'].rsplit('/', 1)[-1][:8]}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(entry, indent=1) + "\n")
            http("DELETE", f"https://firestore.googleapis.com/v1/{doc['name']}", token=token)
            got += 1
        page = res.get("nextPageToken", "")
        if not page:
            break
    for d in OUT.glob("*/"):
        for old in sorted(d.glob("*.json"))[:-KEEP]:
            old.unlink()
    log(f"Collected {got} report(s)")


if __name__ == "__main__":
    main()
