import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { createTestEmailHandler } = await import('../src/controllers/testEmailController.js');
const { createTestEmailSender } = await import('../src/services/emailService.js');
const user = { id: 1, status: 'Aktif', permissions: ['pengaturan.read'] };
const req = (email = 'target@example.test') => ({ headers: { authorization: 'Bearer valid' }, body: { email } });
const handler = overrides => createTestEmailHandler({ verify: () => ({ sub: '1' }), getUser: async () => user, send: async () => ({ sent: 1 }), ...overrides });
async function run(handle, request = req()) {
  const result = {};
  await handle(request, { json: body => { result.body = body; } }, error => { result.error = error; });
  return result;
}

test('test email validates and normalizes the address without changing settings', async () => {
  const sent = [];
  const result = await run(handler({ send: async email => { sent.push(email); return { sent: 1 }; } }), req(' Target@Example.test '));
  assert.deepEqual(sent, ['target@example.test']);
  assert.equal(result.body.sent, true);
});

test('authentication and settings permissions are required', async () => {
  for (const [overrides, status] of [
    [{ verify: () => null }, 401], [{ verify: () => { throw new Error('Malformed token'); } }, 401],
    [{ getUser: async () => null }, 403],
    [{ getUser: async () => ({ ...user, status: 'Nonaktif' }) }, 403],
    [{ getUser: async () => ({ ...user, permissions: ['barang.read'] }) }, 403],
  ]) {
    const result = await run(handler({ ...overrides, send: async () => { assert.fail('Unexpected email'); } }));
    assert.equal(result.error.status, status);
  }
});

test('rejects malformed, missing, multiple, and header-injected addresses', async () => {
  for (const email of ['', 'invalid', ['target@example.test'], 'a@b.test,c@d.test', 'a@b.test\r\nBCC:c@d.test', 'x'.repeat(255)+'@example.test']) {
    const result = await run(handler({ send: async () => { assert.fail('Unexpected email'); } }), req(email));
    assert.equal(result.error.status, 422);
  }
});

test('rate limit prevents duplicate and concurrent sends, and expires after one minute', async () => {
  let clock = 1000;
  let calls = 0;
  let resolve;
  const handle = handler({ now: () => clock, send: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const first = run(handle);
  await new Promise(done => setImmediate(done));
  assert.equal((await run(handle)).error.status, 429);
  resolve({ sent: 1 });
  await first;
  assert.equal((await run(handle)).error.status, 429);
  clock += 60000;
  const retry = run(handle);
  await new Promise(done => setImmediate(done));
  resolve({ sent: 1 });
  await retry;
  assert.equal(calls, 2);
});

test('SMTP failures expose safe messages and are also rate limited', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', message => logs.push(message));
  for (const [code, status] of [['SMTP_CONFIG', 503], ['EAUTH', 502], ['SMTP_REJECTED', 502]]) {
    const handle = handler({ send: async () => { throw Object.assign(new Error('SMTP_PASSWORD=secret'), { code }); } });
    const result = await run(handle);
    assert.equal(result.error.status, status);
    assert.equal(result.error.message.includes('secret'), false);
    assert.equal((await run(handle)).error.status, 429);
  }
  assert.equal(logs.join('').includes('secret'), false);
});

test('SMTP rejection does not return a false success', async (t) => {
  t.mock.method(console, 'error', () => {});
  const result = await run(handler({ send: async () => ({ sent: 0 }) }));
  assert.equal(result.error.status, 502);
  assert.equal(result.body, undefined);
});

test('Nodemailer test email uses one destination with no fake transaction details', async () => {
  const messages = [];
  const send = createTestEmailSender({
    env: { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'secret', SMTP_PORT: '465' },
    createTransport: () => ({ sendMail: async message => { messages.push(message); return { accepted: [message.to] }; } }),
  });
  assert.deepEqual(await send('target@example.test'), { sent: 1 });
  assert.equal(messages[0].to, 'target@example.test');
  assert.match(messages[0].subject, /Uji Notifikasi Email/);
  assert.equal(messages[0].text.includes('PIN-'), false);
  assert.equal(JSON.stringify(messages).includes('secret'), false);
});
