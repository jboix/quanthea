/**
 * A cache of model responses for the evals, as an AI SDK middleware: each streamed response is
 * kept under a hash of the model and the whole request, and replayed when the same request comes
 * again, so a rerun calls the provider only for what changed. Ids a run makes anew, such as a
 * channel's, are written as stable aliases in the key and the kept response. Live calls are spaced
 * out to stay under a free tier's per-minute limit.
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
  /**
   * Ids the run made, each with the stable alias the cache writes instead, such as
   * `evals-channel`. The run may add to it while it goes.
   */
  readonly aliases?: ReadonlyMap<string, string>;
}

/** What a run of the cache did, for the report. */
export interface CacheCounts {
  /** Responses replayed from the cache. */
  hits: number;
  /** Responses the provider gave. */
  misses: number;
}

/** No aliases: every id is written as it is. */
const noAliases: ReadonlyMap<string, string> = new Map();

/**
 * A text with each id the run made replaced by its alias.
 *
 * @param text - The text.
 * @param aliases - The ids and their aliases.
 * @returns The text, the same on every run.
 */
function aliased(text: string, aliases: ReadonlyMap<string, string>): string {
  let written = text;
  for (const [id, alias] of aliases) written = written.replaceAll(id, alias);
  return written;
}

/**
 * A kept text with each alias replaced by the id this run made.
 *
 * @param text - The kept text.
 * @param aliases - The ids and their aliases.
 * @returns The text, with this run's ids.
 */
function revealed(text: string, aliases: ReadonlyMap<string, string>): string {
  let written = text;
  for (const [id, alias] of aliases) written = written.replaceAll(alias, id);
  return written;
}

/**
 * The key of a request: a hash of the model and everything it is sent, its ids aliased.
 *
 * @param modelId - The model.
 * @param params - The request.
 * @param aliases - The ids the run made and their aliases.
 * @returns The key.
 */
function keyOf(
  modelId: string,
  params: LanguageModelV4CallOptions,
  aliases: ReadonlyMap<string, string>,
): string {
  const { prompt, tools, toolChoice, responseFormat } = params;
  const request = JSON.stringify({ modelId, prompt, tools, toolChoice, responseFormat });
  return new Bun.CryptoHasher('sha256').update(aliased(request, aliases)).digest('hex');
}

/**
 * The parts of a kept response, their dates revived and their aliases replaced by this run's ids.
 *
 * @param path - The file.
 * @param aliases - The ids the run made and their aliases.
 * @returns The parts.
 */
function readParts(
  path: string,
  aliases: ReadonlyMap<string, string>,
): LanguageModelV4StreamPart[] {
  const text = revealed(readFileSync(path, 'utf8'), aliases);
  const parts = JSON.parse(text) as LanguageModelV4StreamPart[];
  return parts.map((part) =>
    part.type === 'response-metadata' && typeof part.timestamp === 'string'
      ? { ...part, timestamp: new Date(part.timestamp) }
      : part,
  );
}

/**
 * Keeps a response once it has streamed to its end without an error, its ids aliased.
 *
 * @param stream - A copy of the response.
 * @param path - The file to keep it in.
 * @param aliases - The ids the run made and their aliases.
 * @returns Once it is kept, or dropped.
 */
async function keep(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  path: string,
  aliases: ReadonlyMap<string, string>,
): Promise<void> {
  const parts: LanguageModelV4StreamPart[] = [];
  for await (const part of stream) parts.push(part);
  const finished = parts.some((part) => part.type === 'finish');
  if (finished && !parts.some((part) => part.type === 'error'))
    writeFileSync(path, aliased(JSON.stringify(parts), aliases));
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
  const aliases = options.aliases ?? noAliases;
  return {
    specificationVersion: 'v4',
    wrapStream: async ({ doStream, params, model }) => {
      const path = join(options.dir, `${keyOf(model.modelId, params, aliases)}.json`);
      if (options.read && existsSync(path)) {
        counts.hits += 1;
        return { stream: simulateReadableStream({ chunks: readParts(path, aliases) }) };
      }
      if (!options.live)
        throw new Error('No cached response for this request, and no GEMINI_API_KEY to ask.');
      await pace(state, options.minIntervalMs);
      counts.misses += 1;
      const result = await doStream();
      const [kept, passed] = result.stream.tee();
      void keep(kept, path, aliases);
      return { ...result, stream: passed };
    },
  };
}
