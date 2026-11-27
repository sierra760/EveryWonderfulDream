import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPatentee, indexLabel, surnameOf } from '../scripts/lib/names.mjs';

test('puts the given names first', () => {
  assert.equal(formatPatentee('SEM RUTH'), 'Ruth Sem');
  assert.equal(formatPatentee('HILLMAN LILA JUNE'), 'Lila June Hillman');
  assert.equal(formatPatentee('LEE CATHERINE W'), 'Catherine W Lee');
  assert.equal(formatPatentee('  kerns   howard wilbur '), 'Howard Wilbur Kerns');
});

test('handles Mc, particles and suffixes', () => {
  assert.equal(formatPatentee('MCBRIDE ELVIS'), 'Elvis McBride');
  assert.equal(formatPatentee('VAN CLEAVE FLOYD ERNEST'), 'Floyd Ernest Van Cleave');
  assert.equal(formatPatentee('DE LEON LINO B'), 'Lino B De Leon');
  assert.equal(formatPatentee('RYAN FRANK VAN BUREN JR'), 'Frank Van Buren Ryan Jr.');
  assert.equal(formatPatentee('HEWSON WILLIAM M JUNIOR'), 'William M Hewson Jr.');
  assert.equal(formatPatentee('PARKE WILLIAM HENRY WELDON SEN'), 'William Henry Weldon Parke Sr.');
  assert.equal(formatPatentee('BARTEL ARTHUR WILLIAM 2ND'), 'Arthur William Bartel II');
  assert.equal(formatPatentee("O'BRIEN MARY"), "Mary O'Brien");
});

test('heirs and devisees', () => {
  assert.equal(formatPatentee('NICOLAI LILLIAN M HEIRS OF'), 'Heirs of Lillian M Nicolai');
  assert.equal(formatPatentee('COLEY KENNETH PHILIPPE HEIRS O'), 'Heirs of Kenneth Philippe Coley');
  assert.equal(formatPatentee('PALMER BESS M HEIR OF'), 'Heir of Bess M Palmer');
  assert.equal(formatPatentee('BEALL CLIFFORD M DEVISEES OF'), 'Devisees of Clifford M Beall');
});

test('organizations are left in order; surnames that look like them are not', () => {
  assert.equal(formatPatentee('YUCCA VALLEY LIONS CLUB CO'), 'Yucca Valley Lions Club Co');
  assert.equal(formatPatentee('DOMINGUES SPORTSMAN CLUB'), 'Domingues Sportsman Club');
  assert.equal(formatPatentee('CHRISTIAN AND MISSIONARY'), 'Christian and Missionary');
  assert.equal(formatPatentee('CHURCH PEARL'), 'Pearl Church');
  assert.equal(formatPatentee('CAYGILL LODGE L'), 'Lodge L Caygill');
  assert.equal(formatPatentee('POST MARIE C'), 'Marie C Post');
});

test('edge cases', () => {
  assert.equal(formatPatentee(''), '');
  assert.equal(formatPatentee('CHER'), 'Cher');
  assert.equal(surnameOf('MCBRIDE ELVIS'), 'McBride');
});

test('index labels are surname first', () => {
  assert.equal(indexLabel('SEM RUTH'), 'Sem, Ruth');
  assert.equal(indexLabel('RYAN FRANK VAN BUREN JR'), 'Ryan, Frank Van Buren Jr.');
  assert.equal(indexLabel('VAN CLEAVE FLOYD ERNEST'), 'Van Cleave, Floyd Ernest');
  assert.equal(indexLabel('NICOLAI LILLIAN M HEIRS OF'), 'Nicolai, Lillian M (heirs of)');
  assert.equal(indexLabel('DOMINGUES SPORTSMAN CLUB'), 'Domingues Sportsman Club');
});
