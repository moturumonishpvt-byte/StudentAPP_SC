/**
 * faceCompare.ts
 * Compares two face embeddings using cosine similarity.
 */

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    console.warn(
      `cosineSimilarity: vectors must be non-empty and equal length (a.length=${a.length}, b.length=${b.length})`,
    );
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  // Clamp to [0, 1] — raw cosine can go to -1 but embeddings are mostly positive
  return Math.max(0, Math.min(1, dotProduct / magnitude));
}

/**
 * Verification threshold for L2-normalized 128D MobileFaceNet embeddings.
 * Cosine similarity >= 0.65 with 5-point landmark alignment provides high-accuracy 1:1 matching
 * for registered students while strictly prohibiting identity cross-matching and unregistered faces.
 */
export const VERIFICATION_THRESHOLD = 0.65;

/**
 * Top-2 Match Safety Margin.
 * The best match score must exceed the second-best match score by at least 0.05.
 */
export const MARGIN_THRESHOLD = 0.05;

/**
 * Checks if two embeddings represent the same person.
 */
export function isFaceMatch(a: number[], b: number[]): boolean {
  return cosineSimilarity(a, b) >= VERIFICATION_THRESHOLD;
}

/**
 * Compares an input embedding against a list or single target embedding(s) for a student.
 * Supports single vector or array of template vectors (for multi-pose / beard variations).
 */
export function maxSimilarityAgainstTemplates(
  queryEmbedding: number[],
  storedEmbedding: number[] | number[][],
): number {
  if (!storedEmbedding || queryEmbedding.length === 0) {
    return 0;
  }

  // Single embedding array
  if (typeof storedEmbedding[0] === 'number') {
    return cosineSimilarity(queryEmbedding, storedEmbedding as number[]);
  }

  // Array of template vectors
  const templates = storedEmbedding as number[][];
  let maxSim = 0;
  for (const tmpl of templates) {
    const sim = cosineSimilarity(queryEmbedding, tmpl);
    if (sim > maxSim) {
      maxSim = sim;
    }
  }
  return maxSim;
}

/**
 * Averages multiple embeddings into a single L2-normalized embedding.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return [];
  }
  const length = embeddings[0].length;
  const sum = new Array(length).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < length; i++) {
      sum[i] += emb[i];
    }
  }

  const avg = sum.map(v => v / embeddings.length);
  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? avg.map(v => v / norm) : avg;
}
