/**
 * A cache of model responses for the evals, as an AI SDK middleware: each streamed response is
 * kept under a hash of the model and the whole request, and replayed when the same request comes
 * again, so a rerun calls the provider only for what changed. Live calls are spaced out to stay
 * under a free tier's per-minute limit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';

/** How the cache behaves. */
export interface CacheOptions {
  /** Where responses are kept. */
  readonly dir: string;
  /** Whether a miss may call the provider; without a key, only cached responses play. */
  readonly live: boolean;
  /** Whether to read the cache; off, every call goes to the provider and is kept again. */
  readonly read: boolean;
  /** The least time between two live calls, in milliseconds. */
  readonly minIntervalMs: number;
}

/** What a run of the cache did, for the report. */
export interface CacheCounts {
  /** Responses replayed from the cache. */
  hits: number;
  /** Responses the provider gave. */
  misses: number;
}

/**
 * The key of a request: a hash of the model and everything it is sent.
 *
 * @param modelId - The model.
 * @param params - The request.
 * @returns The key.
 */
function keyOf(modelId: string, params: LanguageModelV4CallOptions): string {
  const { prompt, tools, toolChoice, responseFormat } = params;
  const request = JSON.stringify({ modelId, prompt, tools, toolChoice, responseFormat });
  return new Bun.CryptoHasher('sha256').update(request).digest('hex');
}

/**
 * The parts of a kept response, their dates revived.
 *
 * @param path - The file.
 * @returns The parts.
 */
function readParts(path: string): LanguageModelV4StreamPart[] {
  const parts = JSON.parse(readFileSync(path, 'utf8')) as LanguageModelV4StreamPart[];
  return parts.map((part) =>
    part.type === 'response-metadata' && typeof part.timestamp === 'string'
      ? { ...part, timestamp: new Date(part.timestamp) }
      : part,
  );
}

/**
 * Keeps a response once it has streamed to its end without an error.
 *
 * @param stream - A copy of the response.
 * @param path - The file to keep it in.
 * @returns Once it is kept, or dropped.
 */
async function keep(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  path: string,
): Promise<void> {
  const parts: LanguageModelV4StreamPart[] = [];
  for await (const part of stream) parts.push(part);
  const finished = parts.some((part) => part.type === 'finish');
  if (finished && !parts.some((part) => part.type === 'error'))
    writeFileSync(path, JSON.stringify(parts));
}

/**
 * Waits until the least time since the last live call has passed.
 *
 * @param state - When the last live call started.
 * @param minIntervalMs - The least time between two calls.
 * @returns Once the next call may start.
 */
async function pace(state: { last: number }, minIntervalMs: number): Promise<void> {
  const wait = state.last + minIntervalMs - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  state.last = Date.now();
}

/**
 * The caching middleware.
 *
 * @param options - Where to keep responses, and whether to call the provider on a miss.
 * @param counts - Counts the hits and misses.
 * @returns The middleware.
 */
export function cachingMiddleware(
  options: CacheOptions,
  counts: CacheCounts,
): LanguageModelV4Middleware {
  mkdirSync(options.dir, { recursive: true });
  const state = { last: 0 };
  return {
    specificationVersion: 'v4',
    wrapStream: async ({ doStream, params, model }) => {
      const path = join(options.dir, `${keyOf(model.modelId, params)}.json`);
      if (options.read && existsSync(path)) {
        counts.hits += 1;
        return { stream: simulateReadableStream({ chunks: readParts(path) }) };
      }
      if (!options.live)
        throw new Error('No cached response for this request, and no GEMINI_API_KEY to ask.');
      await pace(state, options.minIntervalMs);
      counts.misses += 1;
      const result = await doStream();
      const [kept, passed] = result.stream.tee();
      void keep(kept, path);
      return { ...result, stream: passed };
    },
  };
}
