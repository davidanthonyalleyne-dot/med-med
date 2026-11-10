# Med Med

Yuki's daily heart meds. Log who gave each dose and when, see the month at a glance, and print blank sheets.

It's a single page hosted free on GitHub Pages. Family sync runs on Firebase's free tier, so everyone's phone shows the same log.

## 1. Put it on GitHub Pages

1. On github.com click **New repository**, name it `med-med`, make it **Public** (Pages is free on public repos), and leave it empty.
2. On the empty repo page click **uploading an existing file** and drag in everything in this folder, including the `icons` folder. On a Mac, press Cmd+Shift+. in Finder first so the hidden `.nojekyll` file shows up. Commit.
3. Go to **Settings**, then **Pages**. Under Build and deployment set Source to **Deploy from a branch**, pick **main** and **/ (root)**, and save.

After a minute the app is live at `https://YOUR-USERNAME.github.io/med-med/`. It works straight away, but each phone keeps its own log until you do step 2.

## 2. Turn on family sync (once, about ten minutes)

1. Go to console.firebase.google.com, click **Create a project**, name it `med-med`. You can turn Google Analytics off.
2. In the project, open **Build**, then **Authentication**, click **Get started**, and under Sign-in method enable **Anonymous**.
3. Open **Build**, then **Firestore Database**, click **Create database**, pick the location `northamerica-northeast2 (Toronto)`, and start in **production mode**.
4. In Firestore open the **Rules** tab, replace everything with the contents of `firestore.rules` from this folder, and click **Publish**.
5. Click the gear next to Project Overview, then **Project settings**. Under Your apps click the **</>** (web) button, name it `Med Med`, skip hosting, and register. Firebase shows a `firebaseConfig` block.
6. Copy the `apiKey`, `authDomain`, `projectId` and `appId` values into `firebase-config.js` in your GitHub repo (open the file, click the pencil, paste, commit).
7. Back in Firebase, go to **Authentication**, then **Settings**, then **Authorized domains**, and add `YOUR-USERNAME.github.io`.

The Firebase config is meant to be public. What protects the log is the rules file plus the household code below.

## 3. Start the log and invite everyone

Open the app on your phone. The Today screen asks you to **Start Yuki's log**. That creates a random household code. Then go to the **Print** tab and tap **Copy invite** under Family sync, and send the link to Quinn, Kai, Chelsey and PJ. Opening it once connects their phone to the same log.

Anyone who has the invite link can see and edit the log, so keep it in the family. If it ever leaks, tap **Change** under Family sync on each phone and start a new log.

## 4. Add it to the home screen

On iPhone open the link in Safari, tap Share, then **Add to Home Screen**. It gets the capsule and paw icon and opens full screen like an app. On Android use Chrome's menu and **Add to Home screen**.

## Missed-dose alerts

If a dose isn't logged about 20 minutes after it's due, every phone that turned alerts on gets a notification. A free GitHub Action (`.github/workflows/missed-dose-alerts.yml`) checks the log every 15 minutes. GitHub's scheduler isn't exact, so an alert can land up to about half an hour after the miss, and once in a while a run is skipped.

One-time setup: in the repo go to Settings, then Secrets and variables, then Actions, and add two repository secrets.

| Name | Value |
|---|---|
| `HOUSEHOLD_CODE` | the code shown under Family sync on the Print tab |
| `VAPID_PRIVATE_KEY` | the private push key Claude generated (keep it out of the code) |

Then on each phone open Med Med from the Home Screen icon (on iPhone and iPad alerts only work from there, not from Safari), go to Print, and tap **Turn on** under Missed-dose alerts.

To test it, open the Actions tab, pick Missed-dose alerts and click Run workflow. The log shows what it checked.

If you change the dose times in `index.html`, change `SLOTS` in `scripts/check_missed.py` to match.

## Changing the meds

The schedule lives near the top of the script in `index.html`, in the `SLOTS` list. Edit a time, name or dose there and commit. The app and the printable PDF both read from it.

## Files

- `index.html` is the whole app.
- `firebase-config.js` holds your Firebase keys.
- `firestore.rules` is the database security rules to paste into Firebase.
- `manifest.webmanifest` and `icons/` make it installable with the Med Med icon.
- `sw.js` shows the alerts on each phone.
- `scripts/check_missed.py` and `.github/workflows/missed-dose-alerts.yml` are the alert checker.
