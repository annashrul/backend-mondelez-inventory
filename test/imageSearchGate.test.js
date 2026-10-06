import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const { applyImageSearchGate, imageSearchConfig, scoreFromDistance } = await import('../src/utils/imageSearchGate.js');

const ENV_KEYS = [
  'IMAGE_SEARCH_ABS_MAX',
  'IMAGE_SEARCH_ABS_FLOOR',
  'IMAGE_SEARCH_RATIO_MAX',
  'IMAGE_SEARCH_LIMIT',
  'IMAGE_SEARCH_NEAR_LIMIT',
];

let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function row(id, distance) {
  return { id, nama: `Barang ${id}`, distance };
}

test('membuang kandidat di atas ambang absolut', () => {
  // best = 0.30 -> ceiling relatif 0.30 * 1.6 = 0.48 > absMax 0.45,
  // jadi ambang absolut yang menentukan di sini.
  const results = applyImageSearchGate([row(1, 0.3), row(2, 0.44), row(3, 0.9)], 5);
  assert.deepEqual(results.map((item) => item.id), [1, 2]);
});

test('membuang kandidat yang jauh lebih buruk dari yang terbaik', () => {
  // best = 0.10 -> ceiling relatif = 0.10 * 1.6 = 0.16
  const results = applyImageSearchGate([row(1, 0.1), row(2, 0.35)], 5);
  assert.deepEqual(results.map((item) => item.id), [1]);
});

test('hasil selalu terurut dari yang paling mirip', () => {
  const rows = [row(3, 0.24), row(1, 0.2), row(4, 0.26), row(2, 0.22)];
  const results = applyImageSearchGate(rows, 5);
  assert.deepEqual(results.map((item) => item.distance), [0.2, 0.22, 0.24, 0.26]);
});

test('menghormati batas near-limit meski diminta lebih banyak', () => {
  process.env.IMAGE_SEARCH_NEAR_LIMIT = '2';
  const rows = [row(1, 0.2), row(2, 0.22), row(3, 0.24)];
  const results = applyImageSearchGate(rows, 5);
  assert.equal(results.length, 2);
});

test('skor 1.0 pada batas kuat dan 0 pada batas tolak', () => {
  const config = imageSearchConfig();
  assert.equal(scoreFromDistance(config.absFloor, config), 1);
  assert.equal(scoreFromDistance(config.absMax, config), 0);
  assert.equal(scoreFromDistance(config.absMax + 1, config), 0);
  assert.ok(scoreFromDistance((config.absFloor + config.absMax) / 2, config) > 0.4);
});

test('input kosong menghasilkan hasil kosong', () => {
  assert.deepEqual(applyImageSearchGate([], 5), []);
  assert.deepEqual(applyImageSearchGate([{ id: 1, distance: Number.NaN }], 5), []);
});
