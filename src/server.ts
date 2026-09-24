/**
 * An HTTP server that speaks the OpenAI and Anthropic APIs, so any SDK in any
 * language can use llmao by changing its base URL.
 *
 * ```ts
 * import { serve } from 'llmao/server';
 * const { url } = await serve({ port: 4141 });
 * // OpenAI:    new OpenAI({ baseURL: `${url}/v1`, apiKey: 'llmao' })
 * // Anthropic: new Anthropic({ baseURL: url, apiKey: 'llmao' })
 * ```
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Anthropic, APIError as AnthropicAPIError, type MessageCreateParams } from './anthropic';
import { embed } from './embeddings';
import type { EngineOptions } from './engine';
import { OpenAI, APIError as OpenAIAPIError, type ChatCompletionCreateParams } from './openai';
import { LlmaoUnscriptedError } from './script';
import { LlmaoStream, randomId } from './stream';
import { countTokens } from './tokens';

export type ServerOptions = EngineOptions;

const MAX_BODY_BYTES = 10 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large. Even for a fake model.');
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function startEventStream(response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
}

function headersOf(headers: Headers | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  headers?.forEach((value, key) => (result[key] = value));
  return result;
}

type Flavor = 'openai' | 'anthropic';

function sendError(response: ServerResponse, flavor: Flavor, error: unknown) {
  if (response.headersSent) {
    response.end();
    return;
  }

  let status = 500;
  let message = error instanceof Error ? error.message : 'Unknown error';
  let type = flavor === 'openai' ? 'server_error' : 'api_error';
  let code: string | null = null;
  let headers: Record<string, string> = {};

  if (error instanceof OpenAIAPIError || error instanceof AnthropicAPIError) {
    headers = headersOf(error.headers);
    if (error.status === undefined) {
      // A simulated timeout: answer like a gateway that gave up waiting
      status = 504;
      type = 'timeout';
    } else {
      status = error.status;
      const body = error.error as { type?: string; code?: string | null; error?: { type: string; message: string }; message?: string } | undefined;
      type = (flavor === 'anthropic' ? body?.error?.type : body?.type) ?? type;
      code = flavor === 'openai' ? (body?.code ?? null) : null;
      message = (flavor === 'anthropic' ? body?.error?.message : body?.message) ?? message;
    }
  } else if (error instanceof HttpError) {
    status = error.status;
    type = 'invalid_request_error';
  } else if (error instanceof LlmaoUnscriptedError) {
    status = 400;
    type = 'invalid_request_error';
  }

  sendJson(
    response,
    status,
    flavor === 'openai' ? { error: { message, type, param: null, code } } : { type: 'error', error: { type, message } },
    headers,
  );
}

/** Creates the server without listening, e.g. to mount it in your own tests */
export function createServer(options: ServerOptions = {}): Server {
  // Clients retry on their own, like with the real APIs
  const openai = new OpenAI({ ...options, maxRetries: 0 });
  const anthropic = new Anthropic({ ...options, maxRetries: 0 });

  return createHttpServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('x-request-id', `req_lmao${randomId(16)}`);
    response.setHeader('x-powered-by', 'regex');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    // Stop "thinking" if the client hangs up
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) controller.abort();
    });

    const path = (request.url ?? '/').split('?')[0]!.replace(/\/+$/, '').replace(/^\/v1(?=\/)/, '');
    const flavor: Flavor = path === '/messages' ? 'anthropic' : 'openai';

    try {
      if (request.method === 'GET' && path === '/models') {
        sendJson(response, 200, await openai.models.list());
        return;
      }

      if (request.method === 'POST' && path === '/chat/completions') {
        const params = (await readJson(request)) as ChatCompletionCreateParams;
        if (!Array.isArray(params.messages)) throw new HttpError(400, "'messages' is required.");
        const result = await openai.chat.completions.create({ ...params, model: params.model ?? 'lmao-1' }, { signal: controller.signal });
        if (result instanceof LlmaoStream) {
          startEventStream(response);
          for await (const chunk of result) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
          response.end('data: [DONE]\n\n');
        } else {
          sendJson(response, 200, result);
        }
        return;
      }

      if (request.method === 'POST' && path === '/messages') {
        const params = (await readJson(request)) as MessageCreateParams;
        if (!Array.isArray(params.messages)) throw new HttpError(400, "'messages' is required.");
        const result = await anthropic.messages.create({ ...params, model: params.model ?? 'lmao-1' }, { signal: controller.signal });
        if (result instanceof LlmaoStream) {
          startEventStream(response);
          for await (const event of result) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          response.end();
        } else {
          sendJson(response, 200, result);
        }
        return;
      }

      if (request.method === 'POST' && path === '/embeddings') {
        const params = (await readJson(request)) as { input?: string | string[]; model?: string };
        const inputs = typeof params.input === 'string' ? [params.input] : (params.input ?? []);
        const tokens = inputs.reduce((total, input) => total + countTokens(String(input)), 0);
        sendJson(response, 200, {
          object: 'list',
          model: params.model ?? 'lmao-embed',
          data: inputs.map((input, index) => ({ object: 'embedding', index, embedding: embed(String(input)) })),
          usage: { prompt_tokens: tokens, total_tokens: tokens },
        });
        return;
      }

      throw new HttpError(404, `Unknown route ${request.method} ${request.url}. llmao only fakes /v1/chat/completions, /v1/messages, /v1/embeddings and /v1/models.`);
    } catch (error) {
      if (controller.signal.aborted) return;
      sendError(response, flavor, error);
    }
  });
}

export interface RunningServer {
  server: Server;
  /** Base URL, e.g. `http://127.0.0.1:4141` */
  url: string;
  close(): Promise<void>;
}

/** Starts the server.  Use port 0 to pick a free port, handy in tests. */
export function serve({ port = 4141, host = '127.0.0.1', ...options }: ServerOptions & { port?: number; host?: string } = {}): Promise<RunningServer> {
  const server = createServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
