# Med Med overview

A two-page overview of what Med Med does, with screenshots, in the app's own style.

- `overview.html` is the document, `overview.pdf` the printable copy.
- `shots/` holds the screenshots. They use sample doses from `mock-firebase.js` and a fake household code, never the real log.
- Published artifact: https://claude.ai/artifact/F6Q3d5Up2F9hxuaDKKi44U

## Regenerate

From the repo root, with Playwright installed and `pdftoppm` available:

```sh
node docs/overview/shoot.js   # retakes every screenshot with the clock set to Nov 9, 2026, 3:40 PM
node docs/overview/pdf.js     # prints overview.html to overview.pdf
```

Update the captions and the "Updated" date in `overview.html` whenever the app changes in a way users would notice.
