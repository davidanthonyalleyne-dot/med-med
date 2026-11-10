// Prints overview.html to overview.pdf. Run from the repo root: node docs/overview/pdf.js
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "overview.html"));
  await page.emulateMedia({ media: "print" });
  await page.waitForLoadState("networkidle");
  await page.pdf({ path: path.join(__dirname, "overview.pdf"), format: "Letter", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await browser.close();
  console.log("Saved overview.pdf");
})();
