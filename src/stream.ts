/**
 * An async iterable that can be cancelled, like the streams returned by the
 * official SDKs
 */
export class LlmaoStream<T> implements AsyncIterable<T> {
  readonly controller: AbortController;
  private readonly factory: (signal: AbortSignal) => AsyncGenerator<T>;

  constructor(factory: (signal: AbortSignal) => AsyncGenerator<T>, signal?: AbortSignal) {
    this.factory = factory;
    this.controller = new AbortController();
    if (signal) {
      if (signal.aborted) this.controller.abort(signal.reason);
      else signal.addEventListener('abort', () => this.controller.abort(signal.reason), { once: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.factory(this.controller.signal);
  }

  toReadableStream(): ReadableStream<T> {
    const iterator = this[Symbol.asyncIterator]();
    return new ReadableStream<T>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: () => this.controller.abort(),
    });
  }
}

export function randomId(length = 24): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < length; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

/** Splits a string in a few pieces, the way tool arguments arrive when streamed */
export function chunkString(value: string, pieces = 3): string[] {
  if (value.length === 0) return [];
  const size = Math.ceil(value.length / pieces);
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks;
}
