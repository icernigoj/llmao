/**
 * Compile-time contract with the official SDKs.  If a new SDK version changes
 * its types, `pnpm typecheck` fails here before any user notices.
 */
import type AnthropicSDK from '@anthropic-ai/sdk';
import type { LanguageModelV4, ProviderV4 } from '@ai-sdk/provider';
import type OpenAISDK from 'openai';
import { llmao, type LlmaoProvider } from '../src/ai-sdk';
import type Anthropic from '../src/anthropic';
import type OpenAI from '../src/openai';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

// Responses are assignable to the official types
export type _completion = Assert<Extends<import('../src/openai').ChatCompletion, OpenAISDK.ChatCompletion>>;
export type _chunk = Assert<Extends<import('../src/openai').ChatCompletionChunk, OpenAISDK.ChatCompletionChunk>>;
export type _message = Assert<Extends<import('../src/anthropic').Message, AnthropicSDK.Message>>;
export type _event = Assert<Extends<import('../src/anthropic').MessageStreamEvent, AnthropicSDK.RawMessageStreamEvent>>;

// Requests written for the official SDKs are accepted
declare const openaiParams: OpenAISDK.ChatCompletionCreateParamsNonStreaming;
declare const openaiStreamParams: OpenAISDK.ChatCompletionCreateParamsStreaming;
declare const anthropicParams: AnthropicSDK.MessageCreateParamsNonStreaming;
declare const anthropicStreamParams: AnthropicSDK.MessageCreateParamsStreaming;
declare const openai: OpenAI;
declare const anthropic: Anthropic;
export const _requests = [
  openai.chat.completions.create(openaiParams),
  openai.chat.completions.create(openaiStreamParams),
  anthropic.messages.create(anthropicParams),
  anthropic.messages.create(anthropicStreamParams),
  anthropic.messages.stream(anthropicParams),
];

// The AI SDK provider implements the provider spec
export const _provider: ProviderV4 = llmao;
export const _model: LanguageModelV4 = llmao('lmao-1');
export type _llmaoProvider = Assert<Extends<LlmaoProvider, ProviderV4>>;
