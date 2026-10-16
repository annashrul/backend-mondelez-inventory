import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTextMatches } from '../src/utils/textSearch.js';
const items = [
  { id: 1, nama: 'Belt VPC', kode: 'BRG-001' },
  { id: 2, nama: 'Belt PVC', kode: 'BRG-002' },
  { id: 3, nama: 'Bearing SKF 6204' },
  { id: 4, nama: 'Modular Chain' },
  { id: 5, nama: 'Belt PVC', is_deleted: true },
];
test('exact results precede similar words including swapped non-adjacent letters', () => {
  const matches = rankTextMatches(items, 'belt pvc');
  assert.deepEqual(matches.map(item => item.id), [2, 1]);
  assert.ok(matches[0].text_similarity > matches[1].text_similarity);
});
test('handles misspellings, word order, case and punctuation', () => {
  assert.deepEqual(rankTextMatches(items, 'chain moduler').map(item => item.id), [4]);
  assert.deepEqual(rankTextMatches(items, ' BELT---vpc! ').map(item => item.id), [1, 2]);
  assert.deepEqual(rankTextMatches(items, 'brg-001').map(item => item.id), [1]);
});
test('rejects unrelated terms and differing numeric specifications', () => {
  for (const query of ['motor listrik', 'bearing skf 6205', '', '!!!']) {
    assert.deepEqual(rankTextMatches(items, query), [], query);
  }
});
test('repeated words do not inflate the query or exclude relevant items', () => {
  assert.deepEqual(rankTextMatches(items, 'belt belt').map(item => item.id), [1, 2]);
});

test('recommends products sharing any query word with full matches first', () => {
  const catalog = [
    { id: 1, nama: 'Modular Chain' },
    { id: 2, nama: 'Terminal Block' },
    { id: 3, nama: 'Block Chain' },
    { id: 4, nama: 'Motor Listrik' },
    { id: 5, nama: 'Chain', is_deleted: true },
  ];
  const matches = rankTextMatches(catalog, 'block chain');
  assert.deepEqual(matches.map(item => item.id), [3, 1, 2]);
  assert.ok(matches[0].text_similarity > matches[1].text_similarity);
  assert.deepEqual(rankTextMatches(items, 'belt motor').map(item => item.id), [1, 2]);
});

test('ranks partial recommendations by query coverage and requires an exact word', () => {
  const catalog = [
    { id: 1, nama: 'Modular Chain' },
    { id: 2, nama: 'Block Chain Spare' },
    { id: 3, nama: 'Moduler Chane' },
  ];
  assert.deepEqual(rankTextMatches(catalog, 'block chain spare motor').map(item => item.id), [2, 1]);
  assert.deepEqual(rankTextMatches([{ id: 1, nama: 'Belt' }], 'belp motor'), []);
});

test('joined speech finds constituent product words even without the other word in the catalog', () => {
  assert.deepEqual(rankTextMatches(items, 'blockchain').map(item => item.id), [4]);
  assert.deepEqual(rankTextMatches([{ id: 1, nama: 'Terminal Block' }], 'blockchain').map(item => item.id), [1]);
  const catalog = [
    { id: 1, nama: 'Modular Chain' },
    { id: 2, nama: 'Terminal Block' },
    { id: 3, nama: 'Block Chain' },
    { id: 4, nama: 'Blockchain' },
  ];
  assert.deepEqual(rankTextMatches(catalog, 'blockchain').map(item => item.id), [4, 3, 1, 2]);
  assert.deepEqual(rankTextMatches(catalog, 'block chain').map(item => item.id), [3, 4, 1, 2]);
});

test('joined-word matching generalizes and does not match tiny fragments or numeric suffixes', () => {
  assert.deepEqual(rankTextMatches(items, 'modularchain').map(item => item.id), [4]);
  assert.deepEqual(rankTextMatches(items, 'chainblock').map(item => item.id), [4]);
  assert.deepEqual(rankTextMatches([{ id: 1, nama: 'Bearing Housing' }], 'ballbearing').map(item => item.id), [1]);
  assert.deepEqual(rankTextMatches([{ id: 1, nama: 'Pin' }], 'spindle'), []);
  assert.deepEqual(rankTextMatches(items, 'bearing6205'), []);
});
