import type { Response } from './engine';
import { LlmaoAPIError } from './errors';
import { testingStore } from './testing-store';
import type { Speed } from './types';

const BASE_DELAY: Record<Speed, number> = { instant: 0, fast: 50, realistic: 500, dramatic: 1000 };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Retries simulated failures with exponential backoff, like the official
 * SDKs do, and returns a response that is going to succeed.
 */
export async function withRetries(
  attempt: (attempt: number) => Response,
  {
    maxRetries,
    speed = 'realistic',
    signal,
    toError,
  }: { maxRetries: number; speed?: Speed; signal?: AbortSignal; toError: (error: LlmaoAPIError) => Error },
): Promise<Response> {
  const testing = testingStore();
  const backoffSpeed = (testing.enabled ? testing.overrides.speed : undefined) ?? speed;

  for (let retry = 0; ; retry++) {
    const response = attempt(retry);
    if (!response.failure) return response;

    try {
      await response.wait(signal);
    } catch (error) {
      if (!(error instanceof LlmaoAPIError)) throw error;
      if (retry >= maxRetries) throw toError(error);
      // Like the official SDKs: honor a short retry-after, otherwise back off
      const retryAfterMs = error.kind === 'rate_limit' ? error.retryAfter * 1000 : 0;
      const delay = retryAfterMs > 0 && retryAfterMs <= 60_000 ? retryAfterMs : Math.min(BASE_DELAY[backoffSpeed] * 2 ** retry, 8000);
      await sleep(delay, signal);
    }
  }
}
