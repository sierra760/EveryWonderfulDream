import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLld, townshipKey, townshipShort, townshipLong, subdivisionShort, subdivisionLong, nominalAcres, aliquotParts, aliquotBox,
} from '../scripts/lib/lld.mjs';
import { yearFromPatentNumber, dateFromPatentNumber, ANCHORS } from '../scripts/lib/patent-dates.mjs';

test('parses an aliquot description', () => {
  const l = parseLld('CA 27 0010N 0110E 017 B E2NWSWSE');
  assert.deepEqual(l, { m: 'S', t: '1N', r: '11E', s: 17, type: 'B', sub: 'E2NWSWSE' });
  assert.equal(townshipKey(l), 'S-1N-11E');
  assert.equal(townshipShort(l), 'T1N R11E');
  assert.equal(townshipLong(l), 'Township 1 North, Range 11 East, San Bernardino Meridian');
  assert.equal(subdivisionShort(l), 'E½ NW¼ SW¼ SE¼');
  assert.equal(subdivisionLong(l), 'the east half of the northwest quarter of the southwest quarter of the southeast quarter');
  assert.equal(nominalAcres(l), 5);
});

test('parses lots, Mount Diablo townships and half townships', () => {
  const lot = parseLld('CA 27 0010N 0050E 002 L 100');
  assert.equal(subdivisionShort(lot), 'Lot 100');
  assert.equal(nominalAcres(lot), null);
  const md = parseLld('CA 21 0250S 0430E 004 A SW');
  assert.equal(townshipKey(md), 'M-25S-43E');
  assert.equal(nominalAcres(md), 160);
  const half = parseLld('CA 27 0012N 0050E 001 A NE');
  assert.equal(half.t, '1½N');
  assert.equal(townshipKey(half), 'S-1hN-5E');
});

test('aliquot arithmetic', () => {
  assert.deepEqual(aliquotParts('S2NWSW'), ['S½', 'NW¼', 'SW¼']);
  assert.equal(aliquotParts('LOT4'), null);
  assert.equal(nominalAcres(parseLld('CA 27 0010N 0100E 015 B S2SWSWSE')), 5);
  assert.equal(nominalAcres(parseLld('CA 27 0010N 0100E 015 B W2NENWNE')), 5);
  assert.equal(nominalAcres(parseLld('CA 27 0010N 0100E 015 B NENWNE')), 10);
  assert.equal(nominalAcres(parseLld('CA 27 0010N 0100E 015 3 ALL')), 640);
});

test('places an aliquot part inside its section', () => {
  assert.deepEqual(aliquotBox('E2NWSWSE'), { u0: 0.5625, u1: 0.625, v0: 0.125, v1: 0.25 });
  assert.deepEqual(aliquotBox('NW'), { u0: 0, u1: 0.5, v0: 0.5, v1: 1 });
  assert.deepEqual(aliquotBox('S2NE'), { u0: 0.5, u1: 1, v0: 0.5, v1: 0.75 });
  assert.equal(aliquotBox('ALL'), null);
  // the box's share of the section matches the nominal acreage
  const b = aliquotBox('W2NESWNE');
  assert.equal((b.u1 - b.u0) * (b.v1 - b.v0) * 640, 5);
});

test('rejects junk', () => {
  assert.equal(parseLld(''), null);
  assert.equal(parseLld('CA 99 0010N 0110E 017 B E2'), null);
});

test('patent numbers map to years', () => {
  assert.equal(yearFromPatentNumber('1135268'), 1952); // Ruth Sem, 23 May 1952
  assert.equal(yearFromPatentNumber('1124235'), 1948);
  assert.equal(yearFromPatentNumber('1160000'), 1956);
  assert.equal(yearFromPatentNumber('1237704'), 1964);
  assert.equal(yearFromPatentNumber('04780033'), 1978);
  assert.equal(yearFromPatentNumber('113395'), null);
  assert.equal(yearFromPatentNumber('1882875'), null);
  assert.equal(yearFromPatentNumber(null), null);
});

test('anchors are strictly increasing in number and time', () => {
  for (let i = 1; i < ANCHORS.length; i++) {
    assert.ok(ANCHORS[i][0] > ANCHORS[i - 1][0]);
    assert.ok(ANCHORS[i][1] > ANCHORS[i - 1][1]);
  }
  const d = dateFromPatentNumber('1135268');
  assert.equal(d.toISOString().slice(0, 10), '1952-05-23');
});
