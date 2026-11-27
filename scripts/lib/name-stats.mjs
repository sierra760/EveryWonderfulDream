// Counts for the Names page: which surnames and first names turn up most on
// the patents, who filed beside people of the same name, and a few oddities.
//
// Everything here is read off the BLM index as it stands. A first name is the
// first word after the surname that is longer than an initial, so "RUGG W EARL"
// counts as an Earl. Whether a first name is "usually a woman's" or "usually a
// man's" comes from two hand-kept lists (data/given-names.json); names on
// neither list are left out of that one comparison and nothing else.

import { splitPatentee } from './names.mjs';

const JOINED = new Set(['La', 'Le', 'De']);

/** "W Earl" -> "Earl", "Le Roy A" -> "Le Roy", "J W" -> "" */
export function firstName(given) {
  const words = String(given ?? '').split(' ').filter(Boolean);
  const i = words.findIndex((w) => w.length > 1);
  if (i < 0) return '';
  if (JOINED.has(words[i]) && (words[i + 1]?.length ?? 0) > 1) return `${words[i]} ${words[i + 1]}`;
  return words[i];
}

/**
 * True when two entries on one patent look like one person under two surnames:
 * "ZITTLER DOROTHY JENNY" beside "PEROFF DOROTHY JENNY", or
 * "ROEDER ARMIDA GAMBERONI" beside "GAMBERONI ARMIDA".
 */
export function samePerson(a, b) {
  if (a.org || b.org || !a.given || !b.given || a.surname === b.surname) return false;
  if (a.given === b.given) return true;
  return a.given === `${b.given} ${b.surname}` || b.given === `${a.given} ${a.surname}`;
}

const ranked = (map, limit) =>
  [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

/**
 * @param tracts  [{ id, indexed: string[], twp, twpLabel, sec, place }]
 * @param lists   { women: string[], men: string[], themed: { title, names: string[] }[] }
 */
export function nameStats(tracts, { women = [], men = [], themed = [] } = {}) {
  const isWoman = new Set(women);
  const isMan = new Set(men);

  const surnames = new Map();
  const givens = new Map();
  const fullNames = new Map();
  const initials = new Map();
  const suffixes = new Map();
  const sections = new Map(); // surname|township|section -> tracts
  let entries = 0, people = 0, organizations = 0, heirs = 0, withFirstName = 0;
  let womenCount = 0, menCount = 0;
  let soloWomen = 0, soloMen = 0, soloTracts = 0;
  let shared = 0, sharedSameSurname = 0, twoNames = 0, twoNamesWomen = 0;
  const twoNameExamples = [];

  for (const t of tracts) {
    const parsed = (t.indexed ?? []).map((raw) => splitPatentee(raw));
    if (!parsed.length) continue;
    entries += parsed.length;

    // one person entered under two surnames is one person
    const persons = [];
    let alias = false;
    for (const p of parsed) {
      if (p.org) { organizations++; continue; }
      if (p.lead) heirs++;
      bump(surnames, p.surname);
      bump(initials, p.surname[0].toUpperCase());
      const key = `${p.surname}|${t.twp}|${t.sec}`;
      if (!sections.has(key)) sections.set(key, { surname: p.surname, tracts: new Map() });
      sections.get(key).tracts.set(t.id, t);
      if (persons.some((q) => samePerson(p, q))) { alias = true; continue; }
      persons.push(p);
    }
    if (alias) {
      twoNames++;
      if (persons.some((p) => isWoman.has(firstName(p.given)))) twoNamesWomen++;
      if (twoNameExamples.length < 6 && parsed.length === 2) {
        twoNameExamples.push({ id: t.id, given: parsed[0].given.split(' ')[0], surnames: parsed.map((p) => p.surname) });
      }
    }
    if (persons.length > 1) {
      shared++;
      if (new Set(persons.map((p) => p.surname)).size < persons.length) sharedSameSurname++;
    }

    people += persons.length;
    for (const p of persons) {
      if (p.suffix) bump(suffixes, p.suffix);
      const first = firstName(p.given);
      if (!first) continue;
      withFirstName++;
      bump(givens, first);
      bump(fullNames, `${first} ${p.surname}`);
      if (isWoman.has(first)) womenCount++;
      else if (isMan.has(first)) menCount++;
    }
    if (persons.length === 1) {
      const first = firstName(persons[0].given);
      if (isWoman.has(first)) { soloWomen++; soloTracts++; }
      else if (isMan.has(first)) { soloMen++; soloTracts++; }
    }
  }

  const clusters = [...sections.values()]
    .filter((s) => s.tracts.size > 1)
    .map((s) => {
      const list = [...s.tracts.values()].sort((a, b) => a.id.localeCompare(b.id));
      return {
        surname: s.surname,
        n: list.length,
        twp: list[0].twp,
        twpLabel: list[0].twpLabel,
        sec: list[0].sec,
        place: list[0].place ?? null,
        id: list[0].id,
      };
    })
    .sort((a, b) => b.n - a.n || a.surname.localeCompare(b.surname));

  const byLength = [...surnames.keys()].filter((s) => /^[A-Za-z']+$/.test(s));
  const longest = Math.max(0, ...byLength.map((s) => s.length));
  const shortest = Math.min(...byLength.map((s) => s.length));
  const classed = womenCount + menCount;
  const unlisted = ranked(givens, 400).filter(([g]) => !isWoman.has(g) && !isMan.has(g));

  return {
    entries,
    people,
    organizations,
    heirs,
    surnames: {
      distinct: surnames.size,
      once: [...surnames.values()].filter((n) => n === 1).length,
      top: ranked(surnames, 20),
      longest: byLength.filter((s) => s.length === longest).sort(),
      shortest: byLength.filter((s) => s.length === shortest).sort(),
    },
    initials: Object.fromEntries([...initials].sort()),
    given: {
      distinct: givens.size,
      counted: withFirstName,
      top: ranked(givens, 20),
      women: ranked(givens, Infinity).filter(([g]) => isWoman.has(g)).slice(0, 15),
      men: ranked(givens, Infinity).filter(([g]) => isMan.has(g)).slice(0, 15),
      classed,
      womenCount,
      menCount,
      // only for the build log: common names nobody has sorted yet
      unlisted,
    },
    solo: { tracts: soloTracts, women: soloWomen, men: soloMen },
    fullNames: ranked(fullNames, 8),
    suffixes: Object.fromEntries(ranked(suffixes, 10)),
    shared: { patents: shared, sameSurname: sharedSameSurname },
    twoNames: { patents: twoNames, women: twoNamesWomen, examples: twoNameExamples },
    sideBySide: {
      groups: clusters.length,
      tracts: clusters.reduce((s, c) => s + c.n, 0),
      top: clusters.slice(0, 9),
    },
    themed: themed
      .map((g) => ({
        title: g.title,
        names: g.names.filter((n) => surnames.has(n)).map((n) => [n, surnames.get(n)]),
      }))
      .filter((g) => g.names.length),
  };
}
