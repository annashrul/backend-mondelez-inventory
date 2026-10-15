import { withdrawalHistoryLink } from '../utils/withdrawalHistoryLink.js';
import { formatNumber } from '../utils/numberFormat.js';
import nodemailer from 'nodemailer';
import { pengambilanEmailTemplate, testEmailTemplate, loginEmailTemplate } from './emailTemplates.js';

export function smtpConfig(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('Konfigurasi SMTP belum lengkap'), { code: 'SMTP_CONFIG' });
  }
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === undefined ? port === 465 : env.SMTP_SECURE === 'true',
    requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function recipientEmails(users) {
  return [...new Set(users.map(user => String(user.email || '').trim().toLowerCase())
    .filter(email => /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)))];
}

export function pengambilanEmail(transaction, stokAkhir, company = {}, env = process.env) {
  const historyLink = withdrawalHistoryLink(transaction.no_ref, env);
  const clean = value => String(value ?? '-').replace(/[\r\n]/g, ' ');
  return {
    ...pengambilanEmailTemplate(transaction, stokAkhir, company, env),
    subject: `Pengambilan barang ${clean(transaction.no_ref)} — ${clean(company.nama_perusahaan || 'Mondelez Inventory')}`,
    text: [
      `Notifikasi pengambilan barang — ${clean(company.nama_perusahaan || 'Mondelez Inventory')}`,
      '',
      `No. referensi: ${clean(transaction.no_ref)}`,
      ...(historyLink ? [`Lihat riwayat: ${historyLink}`] : []),
      `Barang: ${clean(transaction.barang_detail?.nama)}`,
      `Jumlah: ${formatNumber(transaction.qty)} ${clean(transaction.barang_detail?.satuan_detail?.nama || '')}`,
      `Pengambil: ${clean(transaction.pemohon)}`,
      `Operator: ${clean(transaction.operator_detail?.nama || transaction.operator_detail?.username)}`,
      `Rak: ${clean(transaction.rak_detail?.nama)}`,
      `Stok akhir: ${formatNumber(stokAkhir)}`,
      `Keterangan: ${clean(transaction.keterangan || '-')}`,
      '', clean(company.alamat || ''), clean(company.telepon || ''), clean(company.email || ''),
    ].join('\n'),
  };
}

export function createPengambilanEmailSender({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  let transport;
  return async (users, transaction, stokAkhir, company) => {
    const recipients = recipientEmails(users);
    if (!recipients.length) return { sent: 0, skipped: true };
    transport ||= createTransport(smtpConfig(env));
    const message = pengambilanEmail(transaction, stokAkhir, company, env);
    let sent = 0;
    let rejected = 0;
    let lastError;
    // Send each recipient a direct To header, as in the test email. Separate
    // messages keep recipient addresses private without using a BCC-only envelope.
    for (const recipient of recipients) {
      try {
        const result = await transport.sendMail({
          from: env.SMTP_FROM || env.SMTP_USER,
          to: recipient,
          ...message,
        });
        if (!result.accepted?.length) throw Object.assign(new Error('SMTP rejected notification email'), { code: 'SMTP_REJECTED' });
        sent += result.accepted.length;
        rejected += result.rejected?.length || 0;
      } catch (error) {
        rejected++;
        lastError = error;
      }
    }
    if (!sent && lastError) throw lastError;
    return { sent, rejected };
  };
}

const send = createPengambilanEmailSender();
export async function sendPengambilanEmail(users, transaction, stokAkhir) {
  // Integration tests must never send real email.
  if (process.env.NODE_ENV === 'test') return { sent: 0, skipped: true };
  return send(users, transaction, stokAkhir, await (await import('./settingsService.js')).getSettings());
}

export function createTestEmailSender({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  let transport;
  return async (email, company = {}) => {
    if (recipientEmails([{ email }]).length !== 1) throw Object.assign(new Error('Alamat email tidak valid'), { code: 'INVALID_EMAIL' });
    transport ||= createTransport(smtpConfig(env));
    const result = await transport.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to: email,
      ...testEmailTemplate(company),
      subject: 'Uji Notifikasi Email — Mondelez Inventory',
      text: 'Ini adalah email uji notifikasi Mondelez Inventory.\n\nKonfigurasi pengiriman email berhasil digunakan. Email ini tidak membuat transaksi pengambilan barang.\n\nSilakan aktifkan Notifikasi Email dan simpan penerima untuk pengiriman otomatis saat pengambilan barang.',
    });
    return { sent: result.accepted?.length || 0 };
  };
}

const sendTest = createTestEmailSender();
export async function sendTestEmail(email) {
  if (process.env.NODE_ENV === 'test') return { sent: 0, skipped: true };
  return sendTest(email, await (await import('./settingsService.js')).getSettings());
}

export async function sendLoginCode(email, code) {
  if (process.env.NODE_ENV === 'test') throw new Error('Use a mocked OTP email sender in tests');
  const company = await (await import('./settingsService.js')).getSettings();
  const transport = nodemailer.createTransport(smtpConfig());
  try {
    const result = await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email,
      ...loginEmailTemplate(code, company),
      subject: 'Kode Verifikasi Login — Mondelez Inventory',
      text: `Kode verifikasi login Anda: ${code}\n\nBerlaku 5 menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini.` });
    if (!result.accepted?.length) throw new Error('SMTP rejected login code');
  } finally { transport.close(); }
}
