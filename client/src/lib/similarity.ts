export const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const bigrams = (value: string) => {
  const compact = normalizeText(value).replace(/\s+/g, "");
  if (compact.length < 2) return compact ? [compact] : [];
  const result: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.push(compact.slice(index, index + 2));
  }
  return result;
};

function diceSimilarity(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);
  let intersection = 0;
  for (const item of b) {
    const count = counts.get(item) ?? 0;
    if (count > 0) { intersection += 1; counts.set(item, count - 1); }
  }
  return (2 * intersection) / (a.length + b.length);
}

export function wordOverlap(left: string, right: string) {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((word) => { if (b.has(word)) intersection += 1; });
  return intersection / Math.max(a.size, b.size);
}

export function similarityPercent(spoken: string, target: string) {
  const spokenNormalized = normalizeText(spoken);
  const targetNormalized = normalizeText(target);
  if (!spokenNormalized || !targetNormalized) return 0;
  if (spokenNormalized === targetNormalized) return 100;
  const containsScore = spokenNormalized.includes(targetNormalized) || targetNormalized.includes(spokenNormalized) ? 92 : 0;
  const diceScore = diceSimilarity(spokenNormalized, targetNormalized) * 100;
  const wordScore = wordOverlap(spokenNormalized, targetNormalized) * 100;
  return Math.round(Math.max(containsScore, diceScore, wordScore));
}