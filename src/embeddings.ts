import { hashString } from './rng';

const EMBEDDING_DIMENSIONS = 256;

/**
 * Feature hashing: every word and pair of words lands in a bucket.  It is
 * not semantic at all, but texts that share words do end up close together.
 */
export function embed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const features = [...words, ...words.slice(1).map((word, i) => `${words[i]} ${word}`)];
  for (const feature of features) {
    const hash = hashString(feature);
    vector[hash % EMBEDDING_DIMENSIONS]! += hash & 0x100000 ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}
