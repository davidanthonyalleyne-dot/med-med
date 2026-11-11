// Stand-in for Firebase used only when taking overview screenshots.
// It serves sample doses so no real log data ever appears in the document.
(function () {
  const P = "Theo", K = "Leo", D = "Sam", C = "Nora", Q = "Maya";
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
  // Sample prescriptions with made-up Rx numbers, pharmacies and phone numbers.
  const meds = {
    pimobendan: { name: "Pimobendan", strength: "7.5 mg", form: "capsule", directions: "Give 1 capsule by mouth every 8 hours", rx: "500123", qty: "180", refills: "0", filled: "2026-10-02", pharmacy: "Corner Compounding Pharmacy", pharmacyAddress: "100 Sample Road, Toronto", pharmacyPhone: "416-555-0142", prescriber: "Dr. Lee, DVM", prescriberPhone: "416-555-0188" },
    diltiazem: { name: "Diltiazem HCl", strength: "60 mg", form: "tablet", directions: "Take 1 tablet every 8 hours", rx: "2004561", qty: "200", refills: "1", filled: "2026-09-22", pharmacy: "Main Street Pharmacy", pharmacyAddress: "200 Example Street, Toronto", pharmacyPhone: "416-555-0117", prescriber: "Dr. Lee, DVM", prescriberPhone: "416-555-0188" },
    furosemide: { name: "Furosemide", strength: "40 mg", form: "tablet", directions: "1 tablet by mouth every 12 hours", rx: "2004789", qty: "120", refills: "2", filled: "2026-10-20", pharmacy: "Main Street Pharmacy", pharmacyAddress: "200 Example Street, Toronto", pharmacyPhone: "416-555-0117", prescriber: "Dr. Lee, DVM", prescriberPhone: "416-555-0188" },
    digoxin: { name: "Digoxin", strength: "0.0625 mg", form: "tablet", directions: "Take 1 tablet every 12 hours with food", rx: "2003902", qty: "120", refills: "1", filled: "2026-10-02", pharmacy: "Main Street Pharmacy", pharmacyAddress: "200 Example Street, Toronto", pharmacyPhone: "416-555-0117", prescriber: "Dr. Lee, DVM", prescriberPhone: "416-555-0188" },
  };
  const snap = (list) => ({
    docs: list.map(([id, v]) => ({ id, data: () => v })),
    docChanges: () => [],
  });
  function coll(name) {
    return {
      doc: (id) => ({
        set: async (v) => { if (name === "days") days[id] = v; if (name === "meds") meds[id] = { ...meds[id], ...v }; },
        get: async () => ({ exists: !!days[id], data: () => days[id] }),
        delete: async () => {},
      }),
      onSnapshot: (cb) => {
        setTimeout(() => cb(snap(name === "meds" ? Object.entries(meds) : [])), 50);
        return () => {};
      },
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
