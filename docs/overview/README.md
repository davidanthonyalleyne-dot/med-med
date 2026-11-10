# Overview document

`overview.html` is a two-page description of what Med Med does, with screenshots, printed to `overview.pdf`.
Update it whenever a feature is added, changed or removed.

1. `node docs/overview/shoot.js`: serves the app locally with family sync off, a made-up log and made-up names
   (no real names or doses appear), and saves the screenshots in `shots/`.
2. Edit `overview.html`: captions, sections, the at-a-glance figures and the "Updated" date.
3. `node docs/overview/pdf.js`: writes `overview.pdf`. It must stay at two Letter pages.

Published copy (republish to the same link after each update): https://claude.ai/artifact/RTzgBJ4xvh8htnfGCqY2SM
