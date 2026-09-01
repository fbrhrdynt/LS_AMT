export const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");
export const fmtDateTime = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return String(d); }
};
export const num = (n) => (n === null || n === undefined || n === "" ? "—" : n);
