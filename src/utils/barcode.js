import { randomInt } from 'node:crypto';

export function barcodeCheckDigit(body) {
  if (!/^\d{12}$/.test(body)) throw new Error('Barcode body must contain 12 digits');
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - sum % 10) % 10);
}

export function generateInternalBarcode() {
  const body = `20${String(randomInt(0, 10000000000)).padStart(10, '0')}`;
  return body + barcodeCheckDigit(body);
}
