// Similarity is a spelling score, not a probability of product identity.
export function normalizeText(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function wordScore(a, b) {
  if (a === b) return 1;
  // Short words and numeric specifications must match exactly.
  if (Math.min(a.length, b.length) < 3 || /\d/.test(a + b)) return 0;
  const mismatches = a.length === b.length
    ? [...a].map((letter, index) => letter === b[index] ? -1 : index).filter(index => index >= 0) : [];
  if (mismatches.length === 2) {
    const [i, j] = mismatches;
    if (a[i] === b[j] && a[j] === b[i]) return 1 - 1 / a.length;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function fieldScore(field, query) {
  const text = normalizeText(field);
  if (!text) return 0;
  if (text === query) return 1;
  if (text.includes(query)) return 0.99;
  // Speech engines may join product words or insert spaces.
  if (text.replaceAll(' ', '') === query.replaceAll(' ', '')) return 0.97;
  const available = text.split(' ');
  const words = [...new Set(query.split(' '))];
  let total = 0;
  let matched = 0;
  let exactWord = false;
  // Match the most specific words first; never reuse a product token.
  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    let best = 0, index = -1;
    available.forEach((candidate, candidateIndex) => {
      const score = wordScore(word, candidate);
      if (score > best) { best = score; index = candidateIndex; }
    });
    if (best < 0.66) {
      // Do not suggest a different size or part number as a spelling correction.
      if (/\d/.test(word)) return 0;
      // A known product word can anchor either end of a joined utterance:
      // blockchain -> block / chain, even if only one exists in the catalog.
      // Require meaningful lengths and consume each part once.
      let remainder = word;
      let covered = 0;
      for (const candidate of [...available].sort((a, b) => b.length - a.length)) {
        if (candidate.length < 4 || /\d/.test(candidate)) continue;
        const atStart = remainder.startsWith(candidate);
        const atEnd = remainder.endsWith(candidate);
        const restLength = remainder.length - candidate.length;
        if ((!atStart && !atEnd) || (restLength !== 0 && restLength < 3)) continue;
        remainder = atStart ? remainder.slice(candidate.length) : remainder.slice(0, -candidate.length);
        covered += candidate.length;
        available.splice(available.indexOf(candidate), 1);
      }
      if (covered) {
        total += covered / word.length;
        exactWord = true;
      }
      continue;
    }
    matched++;
    if (best === 1 && word.length >= 3) exactWord = true;
    total += best;
    available.splice(index, 1);
  }
  if (matched === words.length) return total / words.length * 0.98;
  // Partial recommendations require an exact meaningful word. Keep all full
  // spelling matches above partial matches, then rank partials by coverage.
  return exactWord ? total / words.length * 0.6 : 0;
}

export function rankTextMatches(items, search) {
  const query = normalizeText(String(search).slice(0, 200));
  if (!query) return [];
  return items.filter(item => !item.is_deleted).map(item => ({
    ...item,
    text_similarity: Math.max(...[item.nama, item.kode, item.barcode].map(field => fieldScore(field, query))),
  })).filter(item => item.text_similarity > 0)
    .sort((a, b) => b.text_similarity - a.text_similarity || Number(a.id) - Number(b.id));
}
