import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { barcodeCheckDigit, generateInternalBarcode } from '../src/utils/barcode.js';

process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(tmpdir(), 'inventory-barcode-'));
process.env.DATA_FILE = path.join(directory, 'store.json');
await writeFile(process.env.DATA_FILE, JSON.stringify({ items: [{ barcode: '2000000000008', is_deleted: true }] }));
const { generateBarcode } = await import('../src/repositories/barangRepository.js');
after(() => rm(directory, { recursive: true, force: true }));

test('generated barcodes have 13 numeric digits and a valid check digit', () => {
  assert.equal(barcodeCheckDigit('400638133393'), '1');
  assert.equal(barcodeCheckDigit('200000000000'), '8');
  const barcode = generateInternalBarcode();
  assert.match(barcode, /^20\d{11}$/);
  assert.equal(barcode.at(-1), barcodeCheckDigit(barcode.slice(0, -1)));
  assert.throws(() => barcodeCheckDigit('abc'));
});

test('barcode generation retries collisions, including archived items', async () => {
  let attempts = 0;
  const barcode = await generateBarcode(() => ++attempts === 1 ? '2000000000008' : '2000000000015');
  assert.equal(barcode, '2000000000015');
  assert.equal(attempts, 2);
});

test('barcode generation stops rather than returning a duplicate', async () => {
  let attempts = 0;
  await assert.rejects(generateBarcode(() => { attempts++; return '2000000000008'; }), /unused barcode/);
  assert.equal(attempts, 20);
});
