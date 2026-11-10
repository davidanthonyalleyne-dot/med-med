// Stand-in for Firebase used only when taking overview screenshots.
// It serves sample doses so no real log data ever appears in the document.
(function () {
  const P = "PJ", K = "Kai", D = "David", C = "Chelsey", Q = "Quinn";
  const KEYS = ["early", "late", "afternoon", "evening", "bedtime"];
  const HOURS = [8, 10, 16, 22, 24];
  const sample = {
    1: [P, Q, K, D, C], 2: [P, K, Q, D, C], 3: [P, C, K, D, D], 4: [Q, P, P, C, C],
    5: [P, P, K, D, Q], 6: [P, Q, P, K, C], 7: [K, P, P, null, D], 8: [P, Q, K, D, C],
    9: [K, Q, null, null, null],
  };
  const mins = [4, 11, 7, 15, 9, 3, 12, 6, 18, 2];
  const days = {};
  for (const [d, who] of Object.entries(sample)) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const slots = {};
    who.forEach((w, i) => {
      if (!w) return;
      const t = new Date(`${date}T00:00:00-05:00`);
      t.setHours(HOURS[i], mins[(+d + i) % mins.length]);
      slots[KEYS[i]] = { at: t.toISOString(), by: w };
    });
    days[date] = { date, month: "2026-11", slots };
  }
  const snap = (list) => ({
    docs: list.map(([id, v]) => ({ id, data: () => v })),
    docChanges: () => [],
  });
  function coll(name) {
    return {
      doc: (id) => ({
        set: async (v) => { if (name === "days") days[id] = v; },
        get: async () => ({ exists: !!days[id], data: () => days[id] }),
        delete: async () => {},
      }),
      where: (f, op, val) => ({
        onSnapshot: (cb) => {
          setTimeout(() => cb(snap(Object.entries(days).filter(([, v]) => v.month === val))), 50);
          return () => {};
        },
      }),
    };
  }
  window.firebase = {
    initializeApp: () => ({}),
    auth: () => ({ signInAnonymously: async () => ({}) }),
    firestore: () => ({
      enablePersistence: async () => {},
      collection: (n) => n === "households"
        ? { doc: () => ({ collection: coll }) }
        : coll(n),
    }),
  };
})();
