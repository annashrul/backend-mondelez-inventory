import nodemailer from 'nodemailer';

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

export function pengambilanEmail(transaction, stokAkhir) {
  const clean = value => String(value ?? '-').replace(/[\r\n]/g, ' ');
  return {
    subject: `Pengambilan barang ${clean(transaction.no_ref)} — Mondelez Inventory`,
    text: [
      'Notifikasi pengambilan barang — Mondelez Inventory',
      '',
      `No. referensi: ${clean(transaction.no_ref)}`,
      `Barang: ${clean(transaction.barang_detail?.nama)}`,
      `Jumlah: ${clean(transaction.qty)} ${clean(transaction.barang_detail?.satuan_detail?.nama || '')}`,
      `Pengambil: ${clean(transaction.pemohon)}`,
      `Operator: ${clean(transaction.operator_detail?.nama || transaction.operator_detail?.username)}`,
      `Rak: ${clean(transaction.rak_detail?.nama)}`,
      `Stok akhir: ${clean(stokAkhir)}`,
      `Keterangan: ${clean(transaction.keterangan || '-')}`,
    ].join('\n'),
  };
}

export function createPengambilanEmailSender({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  let transport;
  return async (users, transaction, stokAkhir) => {
    const recipients = recipientEmails(users);
    if (!recipients.length) return { sent: 0, skipped: true };
    transport ||= createTransport(smtpConfig(env));
    const result = await transport.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      bcc: recipients,
      ...pengambilanEmail(transaction, stokAkhir),
    });
    return { sent: result.accepted?.length || 0, rejected: result.rejected?.length || 0 };
  };
}

const send = createPengambilanEmailSender();
export async function sendPengambilanEmail(users, transaction, stokAkhir) {
  // Integration tests must never send real email.
  if (process.env.NODE_ENV === 'test') return { sent: 0, skipped: true };
  return send(users, transaction, stokAkhir);
}
