import test from 'node:test';
import assert from 'node:assert/strict';
import { withdrawalHistoryLink } from '../src/utils/withdrawalHistoryLink.js';
import { pengambilanEmail } from '../src/services/emailService.js';

test('email reference links target the history tab and encode the complete search value', () => {
  const reference = 'AMB-001 / A&B "<item>"';
  const env = { FRONTEND_URL: 'https://inventory.example.test/' };
  const link = withdrawalHistoryLink(reference, env);
  const url = new URL(link);
  assert.equal(url.pathname, '/pengambilan-barang');
  assert.equal(url.searchParams.get('tab'), 'riwayat');
  assert.equal(url.searchParams.get('search'), reference);
  const email = pengambilanEmail({ no_ref: reference, qty: 1 }, 5, {}, env);
  assert.ok(email.html.includes(`href="${link.replaceAll('&', '&amp;')}"`));
  assert.match(email.html, /AMB-001 \/ A&amp;B &quot;&lt;item&gt;&quot;<\/a>/);
  assert.ok(email.text.includes(link));
});

test('links use configured CORS frontend when no explicit frontend URL is set', () => {
  assert.equal(new URL(withdrawalHistoryLink('REF-1', { CORS_ORIGIN: '*,https://inventory.example.test,http://localhost:5173' })).origin, 'https://inventory.example.test');
  assert.equal(withdrawalHistoryLink('REF-1', { FRONTEND_URL: 'javascript:alert(1)' }), null);
  assert.equal(withdrawalHistoryLink(null, {}), null);
});
