/**
 * The world the evals run in: the server's services on a database of their own, the dev data
 * sources as connectors, one notification channel that sends nowhere, Gemini as the model, a clock
 * fixed for the day, and the response cache.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { createAnswers } from '@quanthea/server/src/agent/answer.ts';
import type { Answers } from '@quanthea/server/src/agent/answer-types.ts';
import { languageModel } from '@quanthea/server/src/agent/model.ts';
import { type Agent, createAgent } from '@quanthea/server/src/agent/run.ts';
import {
  devPostgres,
  devPrometheus,
} from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { connectorKinds } from '@quanthea/server/src/connectors/registry.ts';
import { testServices } from '@quanthea/server/src/test/fixtures.ts';
import { channelInputSchema, connectorInputSchema } from '@quanthea/shared';
import { wrapLanguageModel } from 'ai';
import { type CacheCounts, type CacheOptions, cachingMiddleware } from './cache.ts';
import { type EvalProvider, gatewayOf } from './providers.ts';

/** Who the evals act as. */
export const evalsActor = 'evals';

/** The models a run uses. */
export interface EvalModels {
  /** The provider; Google's Gemini in reports written before Anthropic could run. */
  readonly provider?: EvalProvider;
  /** For every job but building and repairs, and for those too unless `build` is given. */
  readonly model: string;
  /** For building and repairs, when it differs. */
  readonly build?: string | undefined;
}

/** What the evals run against. */
export interface EvalWorld {
  /** The server's services. */
  readonly services: Awaited<ReturnType<typeof testServices>>;
  /** The agent, its models behind the cache. */
  readonly agent: Agent;
  /** The dashboard answering service, its model behind the cache. */
  readonly answers: Answers;
  /** The cache's hits and misses. */
  readonly counts: CacheCounts;
  /** The notification channel alerts may name: a webhook to a closed local port. */
  readonly channelId: string;
  /** The ids the run made, with the stable alias the cache writes for each. */
  readonly aliases: Map<string, string>;
  /** Closes the services and deletes the database. */
  readonly close: () => Promise<void>;
}

/**
 * The clock of a run: today at 10:00 UTC, so a day's requests repeat exactly and hit the cache.
 * The dev data's incident is yesterday at 12:02 UTC.
 *
 * @returns The instant.
 */
export function evalsNow(): number {
  const today = new Date();
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10);
}

/**
 * Adds the dev Postgres and Prometheus as connectors, as `bun run dev:seed` does.
 *
 * @param services - The services.
 * @returns Once both are added.
 */
async function addConnectors(services: EvalWorld['services']): Promise<void> {
  const hiddenFields = ['customers.email', 'customers.phone'];
  const postgres = { name: 'postgres-orders', kind: 'postgres', ...devPostgres, hiddenFields };
  const prometheus = { name: 'prometheus-dev', kind: 'prometheus', ...devPrometheus };
  await services.connections.create(connectorInputSchema.parse(postgres), evalsActor);
  await services.connections.create(connectorInputSchema.parse(prometheus), evalsActor);
}

/**
 * Adds the one notification channel alerts may name. Its webhook points at a closed local port,
 * and nothing in a run sends: the evaluator does not run and no test message is asked for.
 *
 * @param services - The services.
 * @returns The channel's id.
 */
async function addChannel(services: EvalWorld['services']): Promise<string> {
  const channel = {
    name: 'Evals test channel',
    kind: 'webhook',
    target: 'http://127.0.0.1:9/hook',
  };
  const created = await services.notifications.create(
    channelInputSchema.parse(channel),
    evalsActor,
  );
  return created.id;
}

/**
 * Builds the models behind the response cache.
 *
 * @param cache - The cache's place, behaviour and aliases.
 * @param counts - Counts the hits and misses.
 * @returns The model builder the agent and the answering service use.
 */
function cachedModels(cache: CacheOptions, counts: CacheCounts): typeof languageModel {
  const middleware = cachingMiddleware(cache, counts);
  return (resolved, job) =>
    wrapLanguageModel({ model: languageModel(resolved, job) as LanguageModelV4, middleware });
}

/**
 * Opens the world: services on a new database, the connectors, Gemini, and the agent and the
 * answering service with their models behind the cache.
 *
 * @param models - The models.
 * @param apiKey - The provider's key, if there is one; without it, only cached responses play.
 * @param cache - The cache's place and behaviour.
 * @returns The world.
 */
export async function openWorld(
  models: EvalModels,
  apiKey: string | undefined,
  cache: Omit<CacheOptions, 'live' | 'aliases'>,
): Promise<EvalWorld> {
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-evals-'));
  const services = await testServices(dir, connectorKinds, evalsNow);
  await addConnectors(services);
  const channelId = await addChannel(services);
  const aliases = new Map([[channelId, 'evals-channel']]);
  const gateway = gatewayOf(models.provider ?? 'google', models);
  await services.modelSettings.save(
    gateway,
    { [gateway.defaultProviderId]: apiKey ?? 'none' },
    evalsActor,
  );
  const counts: CacheCounts = { hits: 0, misses: 0 };
  const buildModel = cachedModels({ ...cache, live: apiKey !== undefined, aliases }, counts);
  const channels = () => services.notifications.picker();
  const agent = createAgent({ ...services, channels, now: evalsNow, buildModel });
  const answers = createAnswers({ ...services, buildModel });
  const close = async () => {
    await services.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { services, agent, answers, counts, channelId, aliases, close };
}
