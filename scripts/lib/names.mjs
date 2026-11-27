// Patentee names as BLM indexed them are upper-case and surname-first
// ("SEM RUTH", "RYAN FRANK VAN BUREN JR", "NICOLAI LILLIAN M HEIRS OF"), cut
// off at 30 characters. This turns them into something a person would write,
// without pretending to know more than the index does: the first word is
// taken as the surname unless it is an obvious particle.

const SUFFIX = {
  JR: 'Jr.', JUNIOR: 'Jr.', SR: 'Sr.', SENIOR: 'Sr.', SEN: 'Sr.', II: 'II', III: 'III', IV: 'IV', '2ND': 'II',
};
const PARTICLES = new Set(['VAN', 'VON', 'DE', 'DEL', 'DI', 'DA', 'LA', 'LE', 'ST', 'DU', 'TEN', 'TER']);
const SECOND_PARTICLES = new Set(['LA', 'LOS', 'DER', 'DEN']);
// Words that mark an organization when they come after the first word
// ("CHURCH PEARL" is a person; "DOMINGUES SPORTSMAN CLUB" is not).
const ORG = /\b(CLUB|SOCIETY|ASSOCIATION|ASSN|INC|CORP|CORPORATION|COMPANY|FOUNDATION|MISSIONARY|AND)\b|\bCO$/;

function titleWord(w) {
  if (w.length === 1) return w;
  if (/^(II|III|IV)$/.test(w)) return w;
  return w
    .toLowerCase()
    .split(/(['-])/)
    .map((part) => (part.length && !/['-]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part))
    .join('')
    .replace(/^Mc([a-z])/, (_, c) => `Mc${c.toUpperCase()}`);
}
const title = (words) => words.map(titleWord).join(' ');

/**
 * Break an indexed name into its parts.
 * Returns { lead, surname, given, suffix, org } where `org` is true when the
 * entry is an organization (then `surname` holds the whole name).
 */
export function splitPatentee(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const out = { lead: '', surname: '', given: '', suffix: '', org: false };
  if (!s) return out;

  // "… HEIRS OF", "… DEVISEES OF" (sometimes truncated to "HEIRS O")
  const heirs = /^(.+?) (HEIRS?|DEVISEES?)(?: OF?)?$/.exec(s);
  if (heirs) {
    s = heirs[1];
    out.lead = `${titleWord(heirs[2])} of`;
  }

  const words = s.split(' ');
  if (words.length > 1 && ORG.test(words.slice(1).join(' '))) {
    out.org = true;
    out.surname = title(words).replace(/ And /g, ' and ');
    return out;
  }
  if (words.length > 2 && SUFFIX[words.at(-1)]) out.suffix = SUFFIX[words.pop()];

  let take = 1;
  if (PARTICLES.has(words[0]) && words.length > 2) {
    take = SECOND_PARTICLES.has(words[1]) && words.length > 3 ? 3 : 2;
  }
  out.surname = title(words.slice(0, take));
  out.given = title(words.slice(take));
  return out;
}

/** "SEM RUTH" -> "Ruth Sem" */
export function formatPatentee(raw) {
  const p = splitPatentee(raw);
  const name = [p.given, p.surname, p.suffix].filter(Boolean).join(' ');
  return p.lead ? `${p.lead} ${name}` : name;
}

/** "SEM RUTH" -> "Sem, Ruth", for an alphabetical index. */
export function indexLabel(raw) {
  const p = splitPatentee(raw);
  const given = [p.given, p.suffix].filter(Boolean).join(' ');
  return (given ? `${p.surname}, ${given}` : p.surname) + (p.lead ? ` (${p.lead.toLowerCase()})` : '');
}

/** Surname as indexed, for sorting. */
export function surnameOf(raw) {
  return titleWord(String(raw ?? '').trim().split(/\s+/)[0] ?? '');
}
