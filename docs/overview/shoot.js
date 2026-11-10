// Screenshots for the overview document:  node docs/overview/shoot.js
// Serves the repo locally with family sync switched off, a made-up dose log, and made-up
// names in place of the family's, so no real information appears in the pictures.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "../.."), out = path.join(__dirname, "shots");
const SAMPLE_PEOPLE = ["Sam", "Alex", "Jordan", "Riley", "Morgan"];
const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split("?")[0]));
  if (f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, b) => {
    if (e) { r.writeHead(404); return r.end(); }
    if (f.endsWith("index.html")) b = Buffer.from(String(b).replace(/const PEOPLE = \[[^\]]*\];/, `const PEOPLE = ${JSON.stringify(SAMPLE_PEOPLE)};`));
    r.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); r.end(b);
  });
}).listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const when = new Date("2026-11-09T17:20:00-05:00");
  // a made-up log for the first nine days of November
  const days = {}, slots = ["early", "late", "afternoon", "evening", "bedtime"], hours = [8, 10, 16, 22, 24];
  for (let d = 1; d <= 9; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`, s = {};
    slots.forEach((k, i) => {
      if (d === 9 && i > 2) return;          // today: the evening doses aren't due yet
      if (d === 4 && i === 3) return;        // one missed dose, to show how it looks
      const t = new Date(`${date}T00:00:00-05:00`); t.setMinutes(hours[i] * 60 + ((d * 7 + i * 3) % 12));
      s[k] = { at: t.toISOString(), by: SAMPLE_PEOPLE[(d + i) % SAMPLE_PEOPLE.length] };
    });
    days[date] = { date, month: "2026-11", slots: s };
  }
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", timezoneId: "America/Toronto" });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());   // family sync off: a local log only
  await ctx.addInitScript((d) => { localStorage.setItem("yukiMeds", JSON.stringify(d)); localStorage.setItem("yukiLastGiver", JSON.stringify("Sam")); }, days);
  const p = await ctx.newPage();
  await p.clock.install({ time: when });
  const snap = async (name) => { await p.waitForTimeout(700); await p.screenshot({ path: path.join(out, name + ".png") }); };
  await p.goto(url + "#today"); await p.waitForTimeout(1200);
  await snap("today");
  await p.click('[data-slot="evening"]').catch(() => p.click("[data-slot]"));
  await snap("log");
  await p.keyboard.press("Escape"); await p.click("#sCancel").catch(() => {});
  await p.goto(url + "#month"); await snap("month");
  await p.goto(url + "#print"); await snap("print");
  await b.close(); server.close();
  console.log("shots saved in", out);
});
