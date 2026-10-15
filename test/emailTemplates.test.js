import test from 'node:test';
import assert from 'node:assert/strict';
import { pengambilanEmailTemplate, testEmailTemplate, loginEmailTemplate } from '../src/services/emailTemplates.js';

test('notification HTML escapes user data and embeds the provided logo inline', () => {
  const email = pengambilanEmailTemplate({ no_ref: 'REF-42', qty: 2, pemohon: '<script>bad</script>', barang_detail: { nama: 'A & B', satuan_detail: { nama: 'Unit' } } }, 8, { nama_perusahaan: 'Company <name>', alamat: '<img src=x onerror=bad>' });
  assert.match(email.html, /REF-42/);
  assert.match(email.html, /A &amp; B/);
  assert.match(email.html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>|onerror=bad>/);
  assert.match(email.html, /8 Unit/);
  assert.match(email.html, /cid:mondelez-inventory-logo/);
  assert.equal(email.attachments[0].cid, 'mondelez-inventory-logo');
  assert.equal(email.attachments[0].contentType, 'image/png');
  assert.ok(Buffer.isBuffer(email.attachments[0].content));
  assert.equal(email.attachments[0].content.subarray(1, 4).toString(), 'PNG');
});

test('test email and OTP use the branded layout with their own instructions', () => {
  const sample = testEmailTemplate({ nama_perusahaan: 'Test Company' });
  assert.match(sample.html, /Test Company/);
  assert.match(sample.html, /tidak membuat transaksi/);
  const otp = loginEmailTemplate('123456');
  assert.match(otp.html, /123456/);
  assert.match(otp.html, /Berlaku 5 menit/);
  assert.match(otp.html, /Jangan bagikan/);
  assert.doesNotMatch(otp.html, /Stok akhir/);
});

test('withdrawal email groups large quantities and balances while preserving identifiers', () => {
  const result = pengambilanEmailTemplate({ no_ref: 'PIN-001234', qty: 12345, barang_detail: { nama: 'Item', satuan_detail: { nama: 'pcs' } } }, 67890, {});
  assert.match(result.html, /12\.345 pcs/);
  assert.match(result.html, /67\.890 pcs/);
  assert.match(result.html, /PIN-001234/);
});
