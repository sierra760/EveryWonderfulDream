// Helpers for reading BLM legal land descriptions (LLDs) as they appear in the
// MLRS case layer, e.g.  "CA 27 0010N 0110E 017 B E2NWSWSE".
//
//   CA      state
//   27      principal meridian (27 = San Bernardino, 21 = Mount Diablo)
//   0010N   township: 3-digit number, 1-digit fraction (0 = whole, 2 = half), direction
//   0110E   range, same layout
//   017     section
//   B       survey-division type (A/B = aliquot part, L = lot, others = special surveys)
//   E2NWSWSE  subdivision, read right to left: the E½ of the NW¼ of the SW¼ of the SE¼

export const MERIDIANS = {
  27: { code: 'S', name: 'San Bernardino Meridian', abbr: 'SBM' },
  21: { code: 'M', name: 'Mount Diablo Meridian', abbr: 'MDM' },
};

const FRACTION = { 0: '', 1: '¼', 2: '½', 3: '¾' };

function tr(token) {
  // "0010N" -> { n: 1, frac: '', dir: 'N', text: '1N' }
  const m = /^(\d{3})(\d)([NSEW])$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  const frac = FRACTION[m[2]] ?? '';
  return { n, frac, dir: m[3], text: `${n}${frac}${m[3]}` };
}

export function parseLld(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 5) return null;
  const meridian = MERIDIANS[Number(t[1])];
  const twp = tr(t[2]);
  const rng = tr(t[3]);
  const sec = Number(t[4]);
  if (!meridian || !twp || !rng || !Number.isFinite(sec)) return null;
  const type = t[5] ?? '';
  const sub = t.slice(6).join(' ');
  return {
    m: meridian.code,
    t: twp.text,
    r: rng.text,
    s: sec,
    type,
    sub,
  };
}

export function townshipKey(lld) {
  return `${lld.m}-${lld.t.replace('½', 'h')}-${lld.r.replace('½', 'h')}`;
}

// "E2NWSWSE" -> ['E½', 'NW¼', 'SW¼', 'SE¼']
export function aliquotParts(sub) {
  const parts = [];
  const re = /([NSEW]2|NE|NW|SE|SW)/gy;
  let m;
  let end = 0;
  while ((m = re.exec(sub))) {
    parts.push(m[1].endsWith('2') ? `${m[1][0]}½` : `${m[1]}¼`);
    end = re.lastIndex;
  }
  return end === sub.length && parts.length ? parts : null;
}

const WORDS = {
  N: 'north', S: 'south', E: 'east', W: 'west',
  NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest',
};

// Short form: "E½ NW¼ SW¼ SE¼" or "Lot 100"
export function subdivisionShort(lld) {
  if (lld.type === 'L') return `Lot ${lld.sub}`;
  if (!lld.sub || lld.sub === 'ALL') return 'All';
  const parts = aliquotParts(lld.sub);
  return parts ? parts.join(' ') : lld.sub;
}

// Long form: "the east half of the northwest quarter of the southwest quarter
// of the southeast quarter"
export function subdivisionLong(lld) {
  if (lld.type === 'L') return `Lot ${lld.sub}`;
  if (!lld.sub || lld.sub === 'ALL') return 'all';
  const parts = aliquotParts(lld.sub);
  if (!parts) return lld.sub;
  return parts
    .map((p) => {
      const dir = p.replace(/[½¼]/, '');
      return `the ${WORDS[dir]} ${p.endsWith('½') ? 'half' : 'quarter'}`;
    })
    .join(' of ');
}

const ordinalWord = (dir) => WORDS[dir][0].toUpperCase() + WORDS[dir].slice(1);

export function townshipLong(lld) {
  const t = /^(\d+)(½?)([NS])$/.exec(lld.t);
  const r = /^(\d+)(½?)([EW])$/.exec(lld.r);
  const mer = Object.values(MERIDIANS).find((m) => m.code === lld.m);
  return `Township ${t[1]}${t[2]} ${ordinalWord(t[3])}, Range ${r[1]}${r[2]} ${ordinalWord(r[3])}, ${mer.name}`;
}

export function townshipShort(lld) {
  return `T${lld.t} R${lld.r}`;
}

// Nominal acreage of an aliquot part of a standard 640-acre section.
export function nominalAcres(lld) {
  if (lld.type === 'L') return null;
  if (!lld.sub || lld.sub === 'ALL') return 640;
  const parts = aliquotParts(lld.sub);
  if (!parts) return null;
  return parts.reduce((a, p) => a / (p.endsWith('½') ? 2 : 4), 640);
}

// Where an aliquot part sits inside its section, as a box in the unit square:
// u runs west to east, v south to north. "E2NWSWSE" -> { u0: .5625, u1: .625, v0: .125, v1: .25 }.
export function aliquotBox(sub) {
  const parts = aliquotParts(sub);
  if (!parts) return null;
  const b = { u0: 0, u1: 1, v0: 0, v1: 1 };
  for (const part of parts.reverse()) {
    const dir = part.replace(/[½¼]/, '');
    const um = (b.u0 + b.u1) / 2;
    const vm = (b.v0 + b.v1) / 2;
    if (dir.includes('N')) b.v0 = vm;
    if (dir.includes('S')) b.v1 = vm;
    if (dir.includes('E')) b.u0 = um;
    if (dir.includes('W')) b.u1 = um;
  }
  return b;
}
