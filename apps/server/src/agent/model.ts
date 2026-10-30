/** Builds the language model a job uses, from the model gateway settings. */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelSettings } from '@quanthea/shared';
import { type LanguageModel, wrapLanguageModel } from 'ai';
import { gatewayFetch } from '../settings/gateway-fetch.ts';
import type { ResolvedModelSettings } from '../settings/model-settings.ts';
import {
  bearerFetch,
  clientCredentialsOf,
  modelTokens,
  type TokenSource,
} from '../settings/model-token.ts';
import { quotaMiddleware } from './quota.ts';

/** A job of the model: planning, building, repairing queries, writing titles and tags, or answering. */
export type ModelJob = keyof ModelSettings['models'];

/** Gives the model of a job. */
export type ModelOf = (job: ModelJob) => LanguageModel;

/** Why no model could be built. */
export class ModelUnavailableError extends Error {
  /**
   * Creates the error.
   *
   * @param message - What is missing, in words an admin can act on.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * The model id of a job; an empty plan, repair, metadata or answer model means the build model.
 *
 * @param settings - The settings.
 * @param job - The job.
 * @returns The model id.
 */
export function modelIdFor(settings: ModelSettings, job: ModelJob): string {
  return settings.models[job] || settings.models.build;
}

/** The connection a provider is built with. */
interface Connection {
  /** The key, if any. */
  readonly apiKey: string | null;
  /** The base URL, if not the provider's own. */
  readonly baseURL: string | undefined;
  /** Sends the requests: the gateway fetch, or one that adds the provider's token. */
  readonly fetch: typeof gatewayFetch;
}

/**
 * The key the SDKs are given for a provider reached through an identity provider. The bearer
 * fetch replaces it with the token, so it is never sent.
 */
const tokenPlaceholder = 'identity-provider-token';

/**
 * The connection of a provider: its key and the gateway fetch, or, through an identity provider,
 * a fetch that sends its token.
 *
 * @param resolved - The settings and the opened key or client secret.
 * @param tokens - The token source.
 * @returns The connection.
 * @throws {ModelUnavailableError} When a provider reached through an identity provider has no
 *   client secret saved.
 */
function connectionOf(resolved: ResolvedModelSettings, tokens: TokenSource): Connection {
  const baseURL = resolved.settings.baseUrl ?? undefined;
  if (resolved.auth?.type !== 'oauth-client-credentials')
    return { apiKey: resolved.apiKey, baseURL, fetch: gatewayFetch };
  const credentials = clientCredentialsOf(resolved.auth, resolved.apiKey);
  if (credentials === null)
    throw new ModelUnavailableError('Save the client secret in Settings → Model first.');
  return { apiKey: tokenPlaceholder, baseURL, fetch: bearerFetch(tokens, credentials) };
}

/**
 * The key, base URL and fetch options of a provider that needs a key.
 *
 * @param connection - The key and the base URL.
 * @returns The options.
 * @throws {ModelUnavailableError} When no key is saved.
 */
function keyed(connection: Connection) {
  if (connection.apiKey === null)
    throw new ModelUnavailableError('Save an API key in Settings → Model first.');
  return {
    apiKey: connection.apiKey,
    fetch: connection.fetch,
    ...(connection.baseURL ? { baseURL: connection.baseURL } : {}),
  };
}

/** A model object as a provider builds it, never a model id string. */
type ProviderModel = Exclude<LanguageModel, string>;

/** How each provider builds a model. */
const builders: Readonly<
  Record<ModelSettings['provider'], (connection: Connection, id: string) => ProviderModel>
> = {
  anthropic: (connection, id) => createAnthropic(keyed(connection))(id),
  openai: (connection, id) => createOpenAI(keyed(connection))(id),
  mistral: (connection, id) => createMistral(keyed(connection))(id),
  'openai-compatible': ({ apiKey, baseURL, fetch }, id) => {
    const options = { name: 'gateway', baseURL: baseURL ?? '', includeUsage: true, fetch };
    return createOpenAICompatible(apiKey ? { ...options, apiKey } : options)(id);
  },
};

/** The reasoning effort a call asks for. */
export type ReasoningEffort = 'none' | 'low';

/**
 * The reasoning effort to ask for, when the settings keep reasoning short. Anthropic models think
 * only when asked, so they are told not to; OpenAI models and gateways get a low effort. Mistral
 * maps every effort to its highest, so it is left alone.
 *
 * @param settings - The model settings.
 * @returns The effort, or `undefined` for the provider's default.
 */
export function reasoningFor(settings: ModelSettings): ReasoningEffort | undefined {
  if (!settings.behaviour.shortReasoning || settings.provider === 'mistral') return undefined;
  return settings.provider === 'anthropic' ? 'none' : 'low';
}

/**
 * The reasoning option of a call: set when the settings keep reasoning short.
 *
 * @param settings - The model settings.
 * @returns `{ reasoning }`, or nothing for the provider's default.
 */
export function reasoningOption(settings: ModelSettings) {
  const reasoning = reasoningFor(settings);
  return reasoning === undefined ? {} : { reasoning };
}

/**
 * Builds the model of a job. The key is passed explicitly: the providers' environment fallbacks
 * are never used, so what runs is what the settings say. Every request goes through the gateway
 * fetch, with its outbound checks; a provider reached through an identity provider sends its
 * token in place of a key. A spent daily quota is not retried.
 *
 * @param resolved - The settings and the opened key or client secret.
 * @param job - The job.
 * @param tokens - The token source; the server's own by default.
 * @returns The model.
 * @throws {ModelUnavailableError} When Anthropic, OpenAI or Mistral has no key saved, or a
 *   provider reached through an identity provider has no client secret.
 */
export function languageModel(
  resolved: ResolvedModelSettings,
  job: ModelJob,
  tokens: TokenSource = modelTokens,
): LanguageModel {
  const { settings } = resolved;
  const connection = connectionOf(resolved, tokens);
  const model = builders[settings.provider](connection, modelIdFor(settings, job));
  return wrapLanguageModel({ model, middleware: quotaMiddleware });
}
