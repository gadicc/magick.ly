/** Selects corpus vectors using the existing cosine MMR ranking and tie order. */
export function maximalMarginalRelevance(
  query: number[],
  candidates: number[][],
  lambda = 0.25,
  k = 4,
): number[] {
  if (!candidates.length || k <= 0) return [];
  if (
    !query.length ||
    !query.every(Number.isFinite) ||
    candidates.some(
      (candidate) =>
        candidate.length !== query.length || !candidate.every(Number.isFinite),
    )
  ) {
    throw new Error("The vector provider returned incompatible embeddings.");
  }

  const relevance = candidates.map((candidate) => cosine(query, candidate));
  let first = 0;
  for (let index = 1; index < relevance.length; index++) {
    if (relevance[index] > relevance[first]) first = index;
  }
  const selected = [first];
  while (selected.length < Math.min(k, candidates.length)) {
    let bestScore = -Infinity;
    let bestIndex = -1;
    for (const [index, candidate] of candidates.entries()) {
      if (selected.includes(index)) continue;
      const redundancy = Math.max(
        ...selected.map((chosen) => cosine(candidate, candidates[chosen])),
      );
      const score = lambda * relevance[index] - (1 - lambda) * redundancy;
      // Strict comparison preserves Pinecone's result order for tied scores.
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    selected.push(bestIndex);
  }
  return selected;
}

function cosine(a: number[], b: number[]): number {
  let product = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let index = 0; index < a.length; index++) {
    product += a[index] * b[index];
    aSquared += a[index] * a[index];
    bSquared += b[index] * b[index];
  }
  const result = product / (Math.sqrt(aSquared) * Math.sqrt(bSquared));
  // The previous LangChain matrix helper treated zero-norm cosine NaN as zero.
  return Number.isNaN(result) ? 0 : result;
}
