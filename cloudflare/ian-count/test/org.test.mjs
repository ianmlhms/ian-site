import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIp, maskIp, orgFromRdap } from '../src/org.js';

const org = (fn) => ({ roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', fn], ['kind', {}, 'text', 'org']]] });
const note = (...description) => [{ description }];

test("a company's own assignment is named", () => {
  assert.deepEqual(orgFromRdap({ name: 'QUELLENHOF-NET', country: 'IT', type: 'ASSIGNED PA', remarks: note('Quellenhof GmbH') }),
    { org: 'Quellenhof GmbH', kind: 'company', country: 'IT' });
  assert.deepEqual(orgFromRdap({ name: 'MANPOWER-LU', country: 'LU', type: 'ASSIGNED PA', remarks: note('Manpower') }),
    { org: 'Manpower', kind: 'company', country: 'LU' });
});
test('providers stay providers', () => {
  assert.deepEqual(orgFromRdap({ name: 'LU-PT-DSL', country: 'LU', type: 'ASSIGNED PA', remarks: note('Dynamic DSL pool'), entities: [org('POST Luxembourg')] }),
    { org: 'POST Luxembourg', kind: 'provider', country: 'LU' });
  assert.equal(orgFromRdap({ name: 'IT-FASTWEB', country: 'IT', type: 'ALLOCATED PA', entities: [org('Fastweb SpA')] })?.kind, 'provider');
});
test("a private person's line is never stored", () => {
  assert.equal(orgFromRdap({ name: 'DUPONT-NET', country: 'LU', type: 'ASSIGNED PA', remarks: note('Jean Dupont') }), null);
  assert.equal(orgFromRdap({ name: 'X', country: 'LU', type: 'ASSIGNED PA', remarks: note('12 rue de la Gare 1234') }), null);
  assert.equal(orgFromRdap(null), null);
});
test('addresses are masked and private ones refused', () => {
  assert.equal(maskIp('195.46.224.37'), '195.46.224.32');
  assert.equal(maskIp('2a02:678:1:2:3:4:5:6'), '2a02:678:1::');
  assert.equal(maskIp('2a02:678::1'), '2a02:678::');
  assert.deepEqual([isPublicIp('10.0.0.1'), isPublicIp('195.46.224.33'), isPublicIp('999.1.1.1'), isPublicIp('fe80::1'), isPublicIp('2a02:678::1')],
    [false, true, false, false, true]);
});
