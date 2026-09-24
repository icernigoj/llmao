import type { FailureKind } from './types';

const STATUS: Record<FailureKind, number | undefined> = {
  rate_limit: 429,
  server_error: 500,
  timeout: undefined,
};

/** A simulated API failure.  The SDK adapters turn it into their own error classes. */
export class LlmaoAPIError extends Error {
  readonly status: number | undefined;
  readonly retryable = true;

  constructor(
    readonly kind: FailureKind,
    /** Seconds a client should wait before retrying a rate limit */
    readonly retryAfter = 20,
  ) {
    super(
      kind === 'rate_limit'
        ? `Rate limit reached. Please try again in ${retryAfter}s. (It's a fake rate limit, but the anxiety is real.)`
        : kind === 'server_error'
          ? "The server had an error while processing your request. It's not you, it's the regex."
          : 'Request timed out. The model got lost in thought.',
    );
    this.name = 'LlmaoAPIError';
    this.status = STATUS[kind];
  }
}
