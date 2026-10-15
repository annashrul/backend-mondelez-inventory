/** Display quantities without changing stored/API numeric values. */
export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 20 }).format(number) : '-';
}
