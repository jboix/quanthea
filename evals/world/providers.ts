/**
 * The model providers the evals run on: Google's Gemini and Anthropic. Each starts from the models
 * quanthea suggests for it (the Gemini preset, Anthropic's defaults): the cheaper model talks, the
 * stronger one builds and repairs.
 */
import {
  defaultModelGateway,
  gatewayPresets,
  type ModelGateway,
  providerProfiles,
} from '@quanthea/shared';

/** The providers a run can use. */
export const evalProviders = ['google', 'anthropic'] as const;

/** One of them. */
export type EvalProvider = (typeof evalProviders)[number];

/** What a provider needs: how to reach it, its key's variable, and its suggested models. */
interface ProviderSetup {
  /** The gateway's provider entry, without its models. */
  readonly entry: Omit<ModelGateway['providers'][number], 'models'>;
  /** The environment variable that holds its API key. */
  readonly keyVariable: string;
  /** The model that talks, and the one that builds. */
  readonly models: { readonly model: string; readonly build: string };
}

/** Gemini, through its OpenAI-compatible endpoint, as the preset sets it up. */
const gemini = gatewayPresets.find((preset) => preset.name === 'Gemini');

/** Each provider's setup. */
const setups: Readonly<Record<EvalProvider, ProviderSetup>> = {
  google: {
    entry: {
      id: 'gemini',
      name: 'Gemini',
      provider: 'openai-compatible',
      baseUrl: gemini?.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    keyVariable: 'GEMINI_API_KEY',
    models: {
      model: gemini?.defaults?.plan ?? 'gemini-3.5-flash-lite',
      build: gemini?.defaults?.build ?? 'gemini-3.8-flash',
    },
  },
  anthropic: {
    entry: {
      id: 'anthropic',
      name: 'Anthropic',
      provider: 'anthropic',
      baseUrl: providerProfiles.anthropic.baseUrl,
    },
    keyVariable: 'ANTHROPIC_API_KEY',
    models: {
      model: providerProfiles.anthropic.defaults.plan,
      build: providerProfiles.anthropic.defaults.build,
    },
  },
};

/**
 * Reads a provider's name.
 *
 * @param value - The name, such as `google`; `google` when absent.
 * @returns The provider.
 * @throws When the name is not a provider the evals know.
 */
export function providerOf(value: string | undefined): EvalProvider {
  const provider = evalProviders.find((each) => each === (value ?? 'google'));
  if (provider === undefined) {
    throw new Error(`--provider must be one of ${evalProviders.join(', ')}, not ${value}.`);
  }
  return provider;
}

/**
 * The models a provider starts with.
 *
 * @param provider - The provider.
 * @returns The model that talks, and the one that builds.
 */
export function suggestedModels(provider: EvalProvider): ProviderSetup['models'] {
  return setups[provider].models;
}

/**
 * The provider's API key, from the environment.
 *
 * @param provider - The provider.
 * @param env - The environment.
 * @returns The key, or `undefined` when it is not set.
 */
export function apiKeyOf(
  provider: EvalProvider,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return env[setups[provider].keyVariable] || undefined;
}

/**
 * The name of the variable that holds a provider's key, for messages.
 *
 * @param provider - The provider.
 * @returns Such as `GEMINI_API_KEY`.
 */
export function keyVariableOf(provider: EvalProvider): string {
  return setups[provider].keyVariable;
}

/**
 * The gateway: one provider with the run's models, the jobs split as quanthea's presets split them,
 * and the default limits and behaviour.
 *
 * @param provider - The provider.
 * @param models - The model that talks, and the one that builds when it differs.
 * @param models.model - The model for every job but building and repairs.
 * @param models.build - The model for building and repairs.
 * @returns The gateway, and the provider's id its key is saved under.
 */
export function gatewayOf(
  provider: EvalProvider,
  models: { readonly model: string; readonly build?: string | undefined },
): ModelGateway {
  const { entry } = setups[provider];
  const build = models.build ?? models.model;
  // As quanthea's presets: the cheaper model talks, titles and answers; the stronger one builds.
  const jobs = {
    plan: models.model,
    build,
    repair: build,
    metadata: models.model,
    answer: models.model,
  };
  return {
    ...defaultModelGateway,
    providers: [{ ...entry, models: jobs }],
    defaultProviderId: entry.id,
  };
}
