/* Diagnostics for David's apps. Records problems only (script errors, taps that did nothing,
   taps something else caught) with recent taps and screen details. Never app data.
   Entries go to the "diag" collection in Med Med's Firestore; a GitHub Action in med-med
   copies them to med-med/data/diag/<app>/ for Claude to read.
   Usage: <script src="diag.js" data-app="name"></script>   Optional: window.__diag("note", "text") */
(function () {
  if (window.__diag) return;
  var S = document.currentScript, APP = (S && S.getAttribute("data-app")) || "app";
  var API = "AIzaSyCSbU0lGluahdHRZTG-DgG1eYW5YbE05Ss", URL_DOC = "https://firestore.googleapis.com/v1/projects/med-med-3bf8c/databases/(default)/documents/diag";
  var QK = "diagQ:" + APP, AK = "diagAt:" + APP, TK = "diagAuth";
  var crumbs = [], seen = {}, timer = 0, sending = false, t0 = Date.now();
  var CTL = "button,a[href],[role=button],[role=tab],[role=link],[role=switch],[role=menuitem],input,select,textarea,label,summary,[onclick]";

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function label(el) {
    if (!el || !el.tagName) return "?";
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    return s.slice(0, 48);
  }
  function crumb(t) { crumbs.push(((Date.now() - t0) / 1000).toFixed(1) + "s " + t); if (crumbs.length > 12) crumbs.shift(); }
  function route() { var h = location.hash; return location.pathname + (/^#[\w\/-]{0,30}$/.test(h) ? h : (h ? "#…" : "")); }
  // Keeps codes, tokens, emails and query strings out of messages.
  function clean(m) {
    return String(m == null ? "" : m)
      .replace(/(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/g, "$1")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
      .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "<code>")
      .replace(/\b[A-Za-z0-9_-]{19,}\b/g, "<id>")
      .slice(0, 400);
  }
  function version() {
    if (window.APP_VERSION) return String(window.APP_VERSION);
    var m = document.querySelector('meta[name$="version"]');
    return m ? m.content : document.lastModified;
  }
  function state() {
    var vv = window.visualViewport, ua = navigator.userAgent, d = document;
    return {
      v: version(), route: route(), w: innerWidth, h: innerHeight,
      vv: vv ? Math.round(vv.width) + "x" + Math.round(vv.height) + "+" + Math.round(vv.offsetTop) : "",
      y: Math.round(scrollY), body: String(d.body && d.body.className || "").slice(0, 120),
      focus: label(d.activeElement), dialogs: [].filter.call(d.querySelectorAll("dialog[open],[aria-modal=true]"), function (x) { return x.offsetParent !== null || getComputedStyle(x).position === "fixed" && x.getClientRects().length; }).length,
      standalone: !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)),
      os: (ua.match(/OS (\d+)_(\d+)/) || []).slice(1).join(".") || (ua.match(/(Mac OS X|Windows NT|Android) [\d._]+/) || [""])[0],
      browser: (ua.match(/(CriOS|Chrome|Firefox|FxiOS|Version)\/\d+/) || [""])[0], online: navigator.onLine, up: Math.round((Date.now() - t0) / 1000)
    };
  }
  function queue() { try { return JSON.parse(ls(QK) || "[]"); } catch (e) { return []; } }

  function diag(kind, msg) {
    try {
      kind = String(kind).slice(0, 24); msg = clean(msg);
      var k = kind + "|" + msg; if ((seen[k] = (seen[k] || 0) + 1) > 3) return;
      var q = queue();
      q.push({ app: APP, at: new Date().toISOString(), kind: kind, msg: msg, state: JSON.stringify(state()), crumbs: JSON.stringify(crumbs.slice()) });
      ls(QK, JSON.stringify(q.slice(-30)));
      clearTimeout(timer); timer = setTimeout(function () { flush(false); }, 5000);
    } catch (e) {}
  }
  window.__diag = diag;

  function post(url, body, tok) {
    var h = { "Content-Type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok;
    return fetch(url, { method: "POST", headers: h, body: JSON.stringify(body), keepalive: true })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function token() {
    var a = null; try { a = JSON.parse(ls(TK) || "null"); } catch (e) {}
    if (a && a.exp > Date.now() + 60000) return Promise.resolve(a.id);
    var p = a && a.refresh
      ? post("https://securetoken.googleapis.com/v1/token?key=" + API, { grant_type: "refresh_token", refresh_token: a.refresh })
          .then(function (r) { return r && r.id_token ? { id: r.id_token, refresh: r.refresh_token, exp: Date.now() + r.expires_in * 1000 } : null; })
      : Promise.resolve(null);
    return p.then(function (n) {
      return n || post("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + API, { returnSecureToken: true })
        .then(function (r) { return r && r.idToken ? { id: r.idToken, refresh: r.refreshToken, exp: Date.now() + r.expiresIn * 1000 } : null; });
    }).then(function (n) { if (!n) throw 0; ls(TK, JSON.stringify(n)); return n.id; });
  }
  // Sends at most every 10 minutes, or right away when the app goes to the background.
  function flush(now) {
    var q = queue(); if (!q.length || sending || !navigator.onLine) return;
    if (!now && Date.now() - (+ls(AK) || 0) < 600000) { clearTimeout(timer); timer = setTimeout(function () { flush(false); }, 600000); return; }
    sending = true; ls(AK, String(Date.now()));
    token().then(function (tok) {
      return q.reduce(function (p, e) {
        return p.then(function (okSoFar) {
          var f = {}; for (var k in e) f[k] = { stringValue: String(e[k]) };
          return post(URL_DOC, { fields: f }, tok).then(function (r) { return okSoFar + (r ? 1 : 0); });
        });
      }, Promise.resolve(0));
    }).then(function (n) {
      if (n) { var cur = queue(); ls(QK, cur.length > q.length ? JSON.stringify(cur.slice(q.length)) : null); }
    }).catch(function () {}).then(function () { sending = false; });
  }

  addEventListener("error", function (e) {
    if (e.target && e.target !== window && e.target.tagName) { diag("load failed", label(e.target) + " " + clean(e.target.src || e.target.href || "")); return; }
    var f = (e.filename || "").split("/").pop();
    diag("error", (e.message || "error") + (f ? " @" + f + ":" + e.lineno + ":" + e.colno : ""));
  }, true);
  addEventListener("unhandledrejection", function (e) {
    var r = e.reason; diag("rejection", r && (r.stack || r.message) ? String(r.message || "") + " " + String(r.stack || "").split("\n").slice(1, 3).join(" ").trim() : r);
  });

  // Taps: remember what was touched; flag a control that changed nothing, or a tap caught by something on top.
  var watching = 0;
  addEventListener("click", function (e) { crumb("tap " + label(e.target)); }, true);
  addEventListener("touchend", function (e) {
    var t = e.changedTouches && e.changedTouches[0]; if (!t || e.target === document.documentElement) return;
    var ctl = e.target.closest && e.target.closest(CTL);
    if (!ctl && document.elementsFromPoint) {
      var under = document.elementsFromPoint(t.clientX, t.clientY);
      for (var i = 1; i < under.length && i < 6; i++) {
        var c = under[i].closest && under[i].closest(CTL);
        if (c && !c.contains(e.target) && !e.target.contains(c)) {
          var cs = getComputedStyle(e.target);
          if (cs.pointerEvents !== "none" && cs.visibility !== "hidden") diag("tap blocked", label(e.target) + " over " + label(c));
          break;
        }
      }
      return;
    }
    if (!ctl || ctl.disabled || /^(INPUT|SELECT|TEXTAREA|LABEL)$/.test(ctl.tagName) || watching) return;
    watching = 1;
    var changed = false, r0 = location.href, y0 = scrollY;
    var mo = new MutationObserver(function () { changed = true; });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    setTimeout(function () {
      mo.disconnect(); watching = 0;
      if (!changed && location.href === r0 && scrollY === y0 && document.visibilityState === "visible") diag("tap ignored", label(ctl));
    }, 900);
  }, { capture: true, passive: true });

  addEventListener("hashchange", function () { crumb("route " + route()); });
  document.addEventListener("visibilitychange", function () { crumb(document.visibilityState); if (document.visibilityState === "hidden") flush(true); });
  addEventListener("pageshow", function (e) { if (e.persisted) crumb("resumed"); });
  addEventListener("load", function () { setTimeout(function () { flush(false); }, 3000); });
})();
