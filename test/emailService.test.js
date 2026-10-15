import test from 'node:test';
import assert from 'node:assert/strict';
import { createPengambilanEmailSender, recipientEmails, smtpConfig } from '../src/services/emailService.js';

const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-password', SMTP_FROM: 'Inventory <sender@example.test>' };
const transaction = { no_ref: 'PIN-123', qty: 2, pemohon: 'Budi', barang_detail: { nama: 'Laptop', satuan_detail: { nama: 'Unit' } }, operator_detail: { nama: 'Operator' }, rak_detail: { nama: 'Rak A' } };

test('SMTP Gmail supports STARTTLS and implicit TLS with bounded timeouts', () => {
  const config = smtpConfig(env);
  assert.equal(config.secure, false);
  assert.equal(config.requireTLS, true);
  assert.equal(config.auth.pass, env.SMTP_PASSWORD);
  assert.equal(config.socketTimeout, 15000);
  assert.equal(smtpConfig({ ...env, SMTP_PORT: '465' }).secure, true);
  assert.throws(() => smtpConfig({}), error => error.code === 'SMTP_CONFIG');
});

test('recipient email addresses are validated and deduplicated', () => {
  assert.deepEqual(recipientEmails([{ email: ' User@Example.test ' }, { email: 'user@example.test' }, { email: 'invalid' }, { email: 'x@y.test\r\nBcc:other@y.test' }, {}]), ['user@example.test']);
});

test('sends private direct-To messages to configured recipients and reuses SMTP transport', async () => {
  const messages = [];
  let transports = 0;
  const send = createPengambilanEmailSender({ env, createTransport: () => {
    transports++;
    return { sendMail: async message => { messages.push(message); return { accepted: [message.to], rejected: [] }; } };
  } });
  const users = [{ email: 'one@example.test' }, { email: 'two@example.test' }, { email: 'ONE@example.test' }];
  assert.deepEqual(await send(users, transaction, 8), { sent: 2, rejected: 0 });
  await send(users, transaction, 8);
  assert.equal(transports, 1);
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.slice(0, 2).map(message => message.to), ['one@example.test', 'two@example.test']);
  assert.ok(messages.every(message => message.bcc === undefined));
  assert.ok(messages.every(message => !JSON.stringify(message).includes(message.to === 'one@example.test' ? 'two@example.test' : 'one@example.test')));
  assert.equal(messages[0].from, env.SMTP_FROM);
  assert.match(messages[0].subject, /PIN-123/);
  assert.match(messages[0].text, /Laptop/);
  assert.match(messages[0].text, /Stok akhir: 8/);
  assert.equal(JSON.stringify(messages).includes(env.SMTP_PASSWORD), false);
});

test('no valid recipients does not create an SMTP connection', async () => {
  const send = createPengambilanEmailSender({ createTransport: () => { throw new Error('Unexpected connection'); } });
  assert.deepEqual(await send([{}], transaction, 8), { sent: 0, skipped: true });
});

test('SMTP failure is surfaced to the notification service for safe handling', async () => {
  const send = createPengambilanEmailSender({ env, createTransport: () => ({ sendMail: async () => { throw Object.assign(new Error('Credentials hidden'), { code: 'EAUTH' }); } }) });
  await assert.rejects(send([{ email: 'one@example.test' }], transaction, 8), error => error.code === 'EAUTH');
});


test('a failed recipient does not stop later configured recipients', async () => {
  const attempts = [];
  const send = createPengambilanEmailSender({ env, createTransport: () => ({ sendMail: async message => {
    attempts.push(message.to);
    if (message.to === 'bad@example.test') throw Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' });
    return { accepted: [message.to], rejected: [] };
  } }) });
  assert.deepEqual(await send([{ email: 'bad@example.test' }, { email: 'good@example.test' }], transaction, 8), { sent: 1, rejected: 1 });
  assert.deepEqual(attempts, ['bad@example.test', 'good@example.test']);
});

test('SMTP accepting no recipients is reported as a failure', async () => {
  const send = createPengambilanEmailSender({ env, createTransport: () => ({ sendMail: async () => ({ accepted: [], rejected: ['one@example.test'] }) }) });
  await assert.rejects(send([{ email: 'one@example.test' }], transaction, 8), error => error.code === 'SMTP_REJECTED');
});
