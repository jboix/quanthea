/**
 * The world the evals run in: the server's services on a database of their own, the dev data
 * sources as connectors, Gemini as the model, a clock fixed for the day, and the response cache.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { languageModel } from '@quanthea/server/src/agent/model.ts';
import { type Agent, createAgent } from '@quanthea/server/src/agent/run.ts';
import {
  devPostgres,
  devPrometheus,
} from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { connectorKinds } from '@quanthea/server/src/connectors/registry.ts';
import { testServices } from '@quanthea/server/src/test/fixtures.ts';
import { connectorInputSchema, defaultModelGateway, type ModelGateway } from '@quanthea/shared';
import { wrapLanguageModel } from 'ai';
import { type CacheCounts, type CacheOptions, cachingMiddleware } from './cache.ts';

/** Gemini's OpenAI-compatible endpoint. */
const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** Who the evals act as. */
export const evalsActor = 'evals';

/** The models a run uses. */
export interface EvalModels {
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
  /** The cache's hits and misses. */
  readonly counts: CacheCounts;
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
 * The gateway: one Gemini provider with the run's models, the default limits and behaviour.
 *
 * @param models - The models.
 * @returns The gateway.
 */
function geminiGateway(models: EvalModels): ModelGateway {
  const build = models.build ?? models.model;
  return {
    ...defaultModelGateway,
    providers: [
      {
        id: 'gemini',
        name: 'Gemini',
        provider: 'openai-compatible',
        baseUrl: geminiUrl,
        models: { plan: models.model, build, repair: build, metadata: models.model },
      },
    ],
    defaultProviderId: 'gemini',
  };
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
 * Opens the world: services on a new database, the connectors, Gemini, the agent behind the cache.
 *
 * @param models - The models.
 * @param apiKey - The Gemini key, if there is one; without it, only cached responses play.
 * @param cache - The cache's place and behaviour.
 * @returns The world.
 */
export async function openWorld(
  models: EvalModels,
  apiKey: string | undefined,
  cache: Omit<CacheOptions, 'live'>,
): Promise<EvalWorld> {
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-evals-'));
  const services = await testServices(dir, connectorKinds, evalsNow);
  await addConnectors(services);
  await services.modelSettings.save(
    geminiGateway(models),
    { gemini: apiKey ?? 'none' },
    evalsActor,
  );
  const counts: CacheCounts = { hits: 0, misses: 0 };
  const middleware = cachingMiddleware({ ...cache, live: apiKey !== undefined }, counts);
  const agent = createAgent({
    ...services,
    now: evalsNow,
    buildModel: (resolved, job) =>
      wrapLanguageModel({ model: languageModel(resolved, job) as LanguageModelV4, middleware }),
  });
  const close = async () => {
    await services.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { services, agent, counts, close };
}
