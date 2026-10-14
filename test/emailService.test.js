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

test('sends only to configured recipients via BCC and reuses SMTP transport', async () => {
  const messages = [];
  let transports = 0;
  const send = createPengambilanEmailSender({ env, createTransport: () => {
    transports++;
    return { sendMail: async message => { messages.push(message); return { accepted: message.bcc, rejected: [] }; } };
  } });
  const users = [{ email: 'one@example.test' }, { email: 'two@example.test' }, { email: 'ONE@example.test' }];
  assert.deepEqual(await send(users, transaction, 8), { sent: 2, rejected: 0 });
  await send(users, transaction, 8);
  assert.equal(transports, 1);
  assert.deepEqual(messages[0].bcc, ['one@example.test', 'two@example.test']);
  assert.equal(messages[0].to, undefined);
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
