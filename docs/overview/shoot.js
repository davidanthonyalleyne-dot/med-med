// Takes the overview screenshots from a local copy of Med Med with sample data.
// Run from the repo root: node docs/overview/shoot.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "shots");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-firebase.js"), "utf8");
const NOW = new Date("2026-11-09T15:40:00-05:00");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

// Made-up household names, so the screenshots never show the real family.
const NAMES = { Quinn: "Maya", Kai: "Leo", David: "Sam", Chelsey: "Nora", PJ: "Theo" };
function sampleNames(html) {
  const real = Object.keys(NAMES);
  html = html.replace(/const PEOPLE = \[[^\]]*\];/, `const PEOPLE = ${JSON.stringify(real.map((n) => NAMES[n]))};`);
  return html.replace(/Quinn, Kai, Chelsey and PJ/g, "Maya, Leo, Nora and Theo");
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  if (file.endsWith("index.html")) return res.end(sampleNames(fs.readFileSync(file, "utf8")));
  fs.createReadStream(file).pipe(res);
});

// Sample household, a remembered giver and alerts switched on, all fake.
const SETUP = `
  localStorage.setItem("yukiHousehold", JSON.stringify("K7QM-4TXD-9PWA-2HCN"));
  localStorage.setItem("yukiLastGiver", JSON.stringify("Nora"));
  localStorage.setItem("yukiAlerts", "true");
  try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (e) {}
  if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = async () =>
    ({ pushManager: { getSubscription: async () => ({ endpoint: "https://example.invalid/push" }) } });
`;

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, timezoneId: "America/Toronto" });
  await ctx.addInitScript(SETUP);
  await ctx.route(/gstatic\.com\/firebasejs\//, (r) => r.fulfill({
    contentType: "text/javascript",
    body: /firebase-app-compat\.js/.test(r.request().url()) ? MOCK : "",
  }));
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  return page;
}

async function open(page, hash) {
  await page.goto(`http://localhost:${server.address().port}/${hash}`);
  await page.waitForTimeout(1200);
  await page.clock.runFor(1500);
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const phone = { width: 390, height: 844 };

  let page = await newPage(browser, phone);
  await open(page, "#today");
  await page.screenshot({ path: path.join(OUT, "today.png") });

  await page.click('.row[data-slot="afternoon"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "log.png") });

  page = await newPage(browser, phone);
  await open(page, "#month");
  await page.screenshot({ path: path.join(OUT, "month.png") });

  page = await newPage(browser, phone);
  await open(page, "#settings");
  await page.screenshot({ path: path.join(OUT, "settings.png") });

  page = await newPage(browser, { width: 1194, height: 834 });
  await open(page, "#today");
  await page.screenshot({ path: path.join(OUT, "ipad.png") });

  // The printable sheet, made by the app's own PDF code.
  const b64 = await page.evaluate(async () => {
    const buf = await buildPdf(2026, 10).arrayBuffer();
    let s = ""; new Uint8Array(buf).forEach((c) => (s += String.fromCharCode(c)));
    return btoa(s);
  });
  const pdf = path.join(OUT, "sheet.pdf");
  fs.writeFileSync(pdf, Buffer.from(b64, "base64"));
  execFileSync("pdftoppm", ["-png", "-r", "110", "-singlefile", pdf, path.join(OUT, "sheet")]);
  fs.unlinkSync(pdf);

  await browser.close();
  server.close();
  console.log("Saved screenshots to", OUT);
})();
