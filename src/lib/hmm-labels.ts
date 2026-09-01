// Observable-state labels — kept in a tiny standalone module so the client
// bundle does not pull in the entire HMM math.

export const N_OBS = 9;

export const OBS_LABELS: string[] = (() => {
  const pm = ["Rise", "Const", "Drop"];
  const md = ["Hi", "Eq", "Lo"];
  const out: string[] = [];
  for (let p = 0; p < 3; p++) for (let m = 0; m < 3; m++) out.push(`${pm[p]}·${md[m]}`);
  return out;
})();
