import { withdrawalHistoryLink } from '../utils/withdrawalHistoryLink.js';
import { formatNumber } from '../utils/numberFormat.js';
import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('../assets/email-logo.png', import.meta.url));
const logoCid = 'mondelez-inventory-logo';
export const escapeHtml = value => String(value ?? '-').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const companyName = company => company?.nama_perusahaan || 'Mondelez Inventory';

function layout({ company = {}, title, preview, body }) {
  const name = escapeHtml(companyName(company));
  const contact = [company.alamat, company.telepon, company.email].filter(Boolean).map(escapeHtml).join('<br>');
  return {
    attachments: [{ filename: 'logo.png', content: logo, contentType: 'image/png', cid: logoCid, contentDisposition: 'inline' }],
    html: `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f8;color:#242333;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e4e4ed;border-radius:16px;overflow:hidden;">
<tr><td align="center" bgcolor="#4f2170" style="padding:28px 32px;text-align:center;background:#4f2170;border-radius:16px 16px 0 0;">
<img src="cid:${logoCid}" width="200" height="67" alt="${name}" style="display:block;margin:0 auto;width:200px;max-width:100%;height:auto;border:0;color:#ffffff;">
<p style="margin:16px 0 0;color:#eadff3;font-size:12px;letter-spacing:2px;">INVENTORY MANAGEMENT</p></td></tr>
<tr><td style="padding:32px;"><p style="margin:0 0 10px;text-align:center;color:#765489;font-size:12px;font-weight:bold;letter-spacing:1px;">${name}</p>
<h1 style="margin:0 0 18px;text-align:center;font-size:24px;line-height:1.35;color:#332044;">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:24px 32px;background:#faf9fc;border-top:1px solid #eeeaf2;border-radius:0 0 16px 16px;">
<p style="margin:0;color:#565061;font-size:13px;line-height:1.7;font-weight:bold;">${name}</p>
${contact ? `<p style="margin:6px 0 0;color:#777080;font-size:12px;line-height:1.7;">${contact}</p>` : ''}
<p style="margin:14px 0 0;color:#918a9a;font-size:11px;line-height:1.6;">Email ini dikirim otomatis oleh sistem inventori. Mohon tidak membalas email ini.</p>
</td></tr></table></td></tr></table></body></html>`,
  };
}

export function pengambilanEmailTemplate(transaction, stokAkhir, company, env = process.env) {
  const historyLink = withdrawalHistoryLink(transaction.no_ref, env);
  const unit = transaction.barang_detail?.satuan_detail?.nama || '';
  const fields = [
    ['No. referensi', transaction.no_ref], ['Barang', transaction.barang_detail?.nama],
    ['Jumlah pengambilan', `${formatNumber(transaction.qty)} ${unit}`.trim()],
    ['Pengambil', transaction.pemohon], ['Operator', transaction.operator_detail?.nama || transaction.operator_detail?.username],
    ['Rak', transaction.rak_detail?.nama], ['Stok akhir', `${formatNumber(stokAkhir)} ${unit}`.trim()],
    ['Keterangan', transaction.keterangan || '-'],
  ];
  const rows = fields.map(([label, value]) => `<tr><td width="38%" style="padding:13px 12px;border-bottom:1px solid #eeeaf2;color:#777080;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:13px 12px;border-bottom:1px solid #eeeaf2;color:#332c3b;font-size:13px;font-weight:bold;line-height:1.6;word-break:break-word;">${label === 'No. referensi' && historyLink ? `<a href="${escapeHtml(historyLink)}" style="color:#4f2170;text-decoration:underline;">${escapeHtml(value)}</a>` : escapeHtml(value)}</td></tr>`).join('');
  return layout({ company, title: 'Notifikasi pengambilan barang', preview: `Pengambilan ${transaction.no_ref ?? '-'} · ${transaction.barang_detail?.nama ?? '-'}`, body: `
<p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#625b6b;">Transaksi pengambilan barang telah diproses. Berikut rincian transaksi dan stok setelah pengambilan.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eeeaf2;border-radius:8px;">${rows}</table>
<p style="margin:24px 0 0;padding:16px;background:#f4f0f8;border-radius:8px;font-size:13px;line-height:1.7;color:#654879;">${historyLink ? 'Klik nomor referensi di atas untuk membuka riwayat pengambilan barang pada aplikasi inventori.' : 'Gunakan nomor referensi di atas untuk menelusuri transaksi pada aplikasi inventori.'}</p>` });
}

export function testEmailTemplate(company) {
  return layout({ company, title: 'Koneksi email berhasil', preview: 'Konfigurasi notifikasi email inventori siap digunakan.', body: `
<p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#625b6b;">Email uji ini memastikan konfigurasi pengiriman email dapat digunakan dengan baik.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px;background:#eef8f2;border:1px solid #d4ecdf;border-radius:8px;color:#246342;font-size:14px;line-height:1.8;"><strong>Pengiriman email berhasil</strong><br>Email ini tidak membuat transaksi atau mengubah stok barang.</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#625b6b;">Aktifkan Notifikasi Email dan simpan daftar penerima di halaman Pengaturan untuk menerima notifikasi pengambilan barang otomatis.</p>` });
}

export function loginEmailTemplate(code, company) {
  return layout({ company, title: 'Verifikasi login Anda', preview: 'Kode verifikasi login berlaku selama 5 menit.', body: `
<p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#625b6b;">Gunakan kode berikut untuk menyelesaikan login ke aplikasi inventori.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px;background:#f4f0f8;border:1px solid #e6dced;border-radius:8px;">
<p style="margin:0 0 12px;color:#765489;font-size:12px;">KODE VERIFIKASI</p><p style="margin:0;font-size:36px;font-weight:bold;letter-spacing:8px;color:#4f2170;">${escapeHtml(code)}</p>
<p style="margin:14px 0 0;color:#777080;font-size:12px;">Berlaku 5 menit · Hanya dapat digunakan sekali</p></td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.8;color:#625b6b;">Jangan bagikan kode ini kepada siapa pun. Jika Anda tidak meminta kode login, abaikan email ini.</p>` });
}
