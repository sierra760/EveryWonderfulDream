// Estimating when a patent was issued from its number.
//
// From 1908 into the 1960s the General Land Office and then BLM numbered
// "serial patents" in one national sequence, so a patent's number places it in
// time. The anchors below were read from individual records on BLM's GLO
// Records site (glorecords.blm.gov) in November 2026; dates in between are
// linearly interpolated. An estimate is good to within a few weeks, which is
// why the atlas only ever shows the *year* and labels it as an estimate.
//
// Later patents carry numbers like 04-78-0033: state 04 (California), fiscal
// year 1978 (July 1977 to June 1978), the 33rd patent of that year. The atlas
// shows the fiscal year for these.

export const ANCHORS = [
  [1124235, '1948-12-08'],
  [1128000, '1950-01-16'],
  [1132000, '1951-05-17'],
  [1135268, '1952-05-23'],
  [1140000, '1953-07-28'],
  [1145000, '1954-06-18'],
  [1151143, '1955-03-29'],
  [1160887, '1956-06-22'],
  [1164028, '1956-09-06'],
  [1169457, '1957-03-20'],
  [1183562, '1958-06-26'],
  [1199103, '1959-09-14'],
  [1214277, '1960-11-08'],
  [1225863, '1962-03-22'],
  // Inferred, not read from a record: the serial series ends near 1,237,700
  // and California's fiscal-year numbers begin with 04-65 (the year starting
  // July 1, 1964), so the last serial patents fall at the end of June 1964.
  [1237704, '1964-06-30'],
].map(([n, d]) => [n, Date.parse(d)]);

// How far outside the anchored range we are willing to extrapolate.
const MARGIN = 6000;

export function dateFromPatentNumber(pat) {
  if (!pat) return null;
  const s = String(pat).trim();
  if (!/^\d{7}$/.test(s)) return null;
  const n = Number(s);
  const first = ANCHORS[0];
  const last = ANCHORS.at(-1);
  if (n < first[0] - MARGIN || n > last[0] + MARGIN) return null;
  let i = ANCHORS.findIndex(([a]) => a >= n);
  if (i === -1) i = ANCHORS.length - 1;
  if (i === 0) i = 1;
  const [n0, t0] = ANCHORS[i - 1];
  const [n1, t1] = ANCHORS[i];
  return new Date(t0 + ((n - n0) / (n1 - n0)) * (t1 - t0));
}

export function yearFromPatentNumber(pat) {
  if (!pat) return null;
  const s = String(pat).trim();
  const fiscal = /^04(\d{2})\d{4}$/.exec(s);
  if (fiscal) {
    const yy = Number(fiscal[1]);
    return yy >= 60 ? 1900 + yy : null;
  }
  const d = dateFromPatentNumber(s);
  return d ? d.getUTCFullYear() : null;
}
