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
  for (const query of ['motor listrik', 'bearing skf 6205', 'belt motor', '', '!!!']) {
    assert.deepEqual(rankTextMatches(items, query), [], query);
  }
});
test('does not reuse one word to satisfy multiple query words', () => {
  assert.deepEqual(rankTextMatches(items, 'belt belt'), []);
});
