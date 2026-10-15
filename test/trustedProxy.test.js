import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { configureTrustedProxy } from '../src/config/trustedProxy.js';

function clientIp(remoteAddress, forwarded, env = {}) {
  const app = express();
  configureTrustedProxy(app, env);
  const req = Object.create(app.request);
  req.app = app;
  req.socket = { remoteAddress };
  req.headers = forwarded ? { 'x-forwarded-for': forwarded } : {};
  return req.ip;
}

test('local tunnel resolves the visitor IP for IPv4 and IPv6 loopback', () => {
  for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(clientIp(remote, '203.0.113.42'), '203.0.113.42');
  assert.equal(clientIp('127.0.0.1','2001:db8::42'), '2001:db8::42');
});

test('untrusted direct connections and forged leftmost forwarded entries cannot override the real client', () => {
  assert.equal(clientIp('198.51.100.7', '203.0.113.99'), '198.51.100.7');
  assert.equal(clientIp('127.0.0.1', '203.0.113.99, 198.51.100.7'), '198.51.100.7');
  assert.equal(clientIp('127.0.0.1', null), '127.0.0.1');
});

test('proxy configuration supports explicit proxy IPs and can be disabled', () => {
  assert.equal(clientIp('127.0.0.1', '203.0.113.42', { TRUST_PROXY: 'false' }), '127.0.0.1');
  assert.equal(clientIp('192.0.2.10', '203.0.113.42', { TRUST_PROXY: '192.0.2.10' }), '203.0.113.42');
});
