/**
 * Test helpers for Jest, Vitest or any other runner.
 *
 * Importing this module turns on test mode: every llmao client, including the
 * ones your app creates on its own, answers instantly, never hallucinates,
 * uses the configuration you set here, and records its calls.
 *
 * ```ts
 * vi.mock('openai', () => import('llmao/openai'));    // Vitest
 * jest.mock('openai', () => require('llmao/openai'));  // Jest
 *
 * import * as llmao from 'llmao/testing';
 *
 * beforeEach(() => llmao.reset());
 *
 * test('classifies tickets', async () => {
 *   llmao.configure({ script: [{ when: /never arrived/, text: 'shipping' }] });
 *   expect(await classify('My order never arrived')).toBe('shipping');
 *   expect(llmao.calls[0].prompt).toContain('never arrived');
 * });
 * ```
 */
import type { EngineOptions } from './engine';
import { testingStore, type Provider, type RecordedCall } from './testing-store';
import type { LlmaoOptions } from './types';

export type { Provider, RecordedCall };

/** Test mode defaults: fast and honest */
const DEFAULTS: LlmaoOptions = { speed: 'instant', hallucinationRate: 0 };

const store = testingStore();
store.enabled = true;
store.overrides = { ...DEFAULTS, ...store.overrides };

/**
 * Every call made by any llmao client since the last `reset()`, oldest first.
 * Retries count as separate calls, like they would on a real API.
 */
export const calls: ReadonlyArray<RecordedCall> = store.calls;

/**
 * Sets the options for every client, overriding what the app passed.  Each
 * call replaces the previous configuration (the test defaults stay).
 */
export function configure(options: Omit<EngineOptions, 'model' | 'attempt' | 'trace'>): void {
  store.overrides = { ...DEFAULTS, ...options };
}

/** Clears the recorded calls and the configuration.  Call it in `beforeEach`. */
export function reset(): void {
  store.overrides = { ...DEFAULTS };
  store.calls.length = 0;
}

/** The most recent call, if any */
export function lastCall(): RecordedCall | undefined {
  return store.calls[store.calls.length - 1];
}

/** Turns test mode off, e.g. to see the realistic timing again */
export function disable(): void {
  store.enabled = false;
}

/** Turns test mode back on after `disable()` */
export function enable(): void {
  store.enabled = true;
}
