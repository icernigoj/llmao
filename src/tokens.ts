/**
 * Splits text into "tokens" the way a BPE tokenizer would if it didn't care
 * much: whitespace stays attached to the following word and long words are
 * broken into ~4 character pieces.  Joining the tokens gives back the input.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/\s*[^\s]+|\s+$/g)) {
    const word = match[0];
    if (word.trim().length <= 6) {
      tokens.push(word);
      continue;
    }
    for (let i = 0; i < word.length; i += 4) {
      tokens.push(word.slice(i, i + 4));
    }
  }
  return tokens;
}

export function countTokens(text: string): number {
  return tokenize(text).length;
}
