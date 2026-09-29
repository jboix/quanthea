/**
 * The model gateway settings: which provider, where, which model for each job, the limits of a
 * run, and how the agent behaves. The API key is stored sealed and never returned.
 */
import { z } from 'zod';

/**
 * The providers the gateway speaks to. OpenAI-compatible covers LiteLLM, Ollama, vLLM, Gemini's
 * OpenAI endpoint and more.
 */
export const modelProviders = ['anthropic', 'openai', 'mistral', 'openai-compatible'] as const;

/** A provider. */
export type ModelProvider = (typeof modelProviders)[number];

/** Validates a model id, such as `claude-sonnet-5`. Empty means "same as build". */
const modelIdSchema = z.string().trim().max(200);

/** The fields of the settings a run uses, before the cross-field checks. */
const modelSettingsFields = z.object({
  provider: z.enum(modelProviders),
  /** The API base URL; required for an OpenAI-compatible gateway, optional otherwise. */
  baseUrl: z
    .url({ protocol: /^https?$/, error: 'Use an http or https URL.' })
    .max(500)
    .nullable(),
  models: z.object({
    /** Talks the question through and proposes plans; empty uses the build model. */
    plan: modelIdSchema.default(''),
    /** Builds and edits dashboards: needs strong tool calling. */
    build: modelIdSchema.min(1, 'Name the model that builds dashboards.'),
    /** Repairs failed queries; empty uses the build model. */
    repair: modelIdSchema,
    /** Writes titles, tags and descriptions; empty uses the build model. */
    metadata: modelIdSchema,
  }),
  limits: z.object({
    /** A thread stops after spending this many tokens. */
    threadTokens: z.int().min(10_000, 'At least 10,000 tokens.').max(10_000_000),
    /** A turn stops after this many tool calls. */
    toolCallsPerTurn: z.int().min(1, 'At least 1.').max(100, 'At most 100.'),
    /** How many times the agent may repair a failing panel. */
    repairAttempts: z.int().min(0).max(10, 'At most 10.'),
  }),
  behaviour: z.object({
    /** Ask for plan approval before building; small edits skip the plan. */
    planApproval: z.boolean(),
    /** Test-run every query before showing a panel. */
    testRun: z.boolean(),
    /** Ask the model to reason briefly: faster and cheaper. Off for gateways that reject it. */
    shortReasoning: z.boolean().default(true),
  }),
});

/** Validates the settings a run uses: one provider with the limits and the behaviour. */
export const modelSettingsSchema = modelSettingsFields.refine(
  (settings) => settings.provider !== 'openai-compatible' || settings.baseUrl !== null,
  { path: ['baseUrl'], message: 'An OpenAI-compatible gateway needs its base URL.' },
);

/** The model settings. */
export type ModelSettings = z.infer<typeof modelSettingsSchema>;

/** The settings before anyone saves them. */
export const defaultModelSettings: ModelSettings = {
  provider: 'anthropic',
  baseUrl: null,
  models: {
    plan: 'claude-haiku-4-5',
    build: 'claude-sonnet-5',
    repair: '',
    metadata: 'claude-haiku-4-5',
  },
  limits: { threadTokens: 200_000, toolCallsPerTurn: 25, repairAttempts: 3 },
  behaviour: { planApproval: true, testRun: true, shortReasoning: true },
};

/** Validates a provider id: lowercase letters, digits and dashes. */
const providerIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lowercase letters, digits and dashes.');

/** The part of the model settings that belongs to one provider. */
const providerFields = modelSettingsFields.pick({
  provider: true,
  baseUrl: true,
  models: true,
});

/** Validates one saved provider: a name, the vendor, where it is, and the model for each job. */
export const providerConfigSchema = providerFields
  .extend({
    id: providerIdSchema,
    name: z.string().trim().min(1, 'Name the provider.').max(60),
  })
  .refine((config) => config.provider !== 'openai-compatible' || config.baseUrl !== null, {
    path: ['baseUrl'],
    message: 'An OpenAI-compatible gateway needs its base URL.',
  });

/** One saved provider. */
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** The settings every provider shares: the limits of a run and how the agent behaves. */
const sharedFields = modelSettingsFields.pick({ limits: true, behaviour: true });

/** Validates the model gateway: the saved providers, the default one, and the shared settings. */
export const modelGatewaySchema = sharedFields
  .extend({
    providers: z.array(providerConfigSchema).min(1, 'Keep at least one provider.').max(12),
    defaultProviderId: providerIdSchema,
  })
  .superRefine((gateway, context) => {
    const ids = gateway.providers.map((config) => config.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', path: ['providers'], message: 'Provider ids repeat.' });
    if (!ids.includes(gateway.defaultProviderId))
      context.addIssue({ code: 'custom', path: ['defaultProviderId'], message: 'Pick a default.' });
  });

/** The model gateway settings. */
export type ModelGateway = z.infer<typeof modelGatewaySchema>;

/** The gateway before anyone saves it: one Anthropic provider. */
export const defaultModelGateway: ModelGateway = {
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      provider: defaultModelSettings.provider,
      baseUrl: defaultModelSettings.baseUrl,
      models: defaultModelSettings.models,
    },
  ],
  defaultProviderId: 'anthropic',
  limits: defaultModelSettings.limits,
  behaviour: defaultModelSettings.behaviour,
};

/**
 * The provider a thread uses: the one it names, or the default when it names none or one that
 * was removed.
 *
 * @param gateway - The gateway.
 * @param providerId - The thread's provider, if any.
 * @returns The provider.
 */
export function providerFor(gateway: ModelGateway, providerId?: string | null): ProviderConfig {
  const named = gateway.providers.find((config) => config.id === providerId);
  const fallback = gateway.providers.find((config) => config.id === gateway.defaultProviderId);
  return named ?? fallback ?? (gateway.providers[0] as ProviderConfig);
}

/**
 * The settings a run uses: one provider with the shared limits and behaviour.
 *
 * @param gateway - The gateway.
 * @param providerId - The thread's provider, if any.
 * @returns The flat settings.
 */
export function settingsFor(gateway: ModelGateway, providerId?: string | null): ModelSettings {
  const { provider, baseUrl, models } = providerFor(gateway, providerId);
  return { provider, baseUrl, models, limits: gateway.limits, behaviour: gateway.behaviour };
}
