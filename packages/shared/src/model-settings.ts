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

/** Validates the model settings. */
export const modelSettingsSchema = z
  .object({
    provider: z.enum(modelProviders),
    /** The API base URL; required for an OpenAI-compatible gateway, optional otherwise. */
    baseUrl: z
      .url({ protocol: /^https?$/, error: 'Use an http or https URL.' })
      .max(500)
      .nullable(),
    models: z.object({
      /** Plans and builds dashboards: needs strong tool calling. */
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
  })
  .refine((settings) => settings.provider !== 'openai-compatible' || settings.baseUrl !== null, {
    path: ['baseUrl'],
    message: 'An OpenAI-compatible gateway needs its base URL.',
  });

/** The model settings. */
export type ModelSettings = z.infer<typeof modelSettingsSchema>;

/** The settings before anyone saves them. */
export const defaultModelSettings: ModelSettings = {
  provider: 'anthropic',
  baseUrl: null,
  models: { build: 'claude-sonnet-5', repair: '', metadata: 'claude-haiku-4-5' },
  limits: { threadTokens: 200_000, toolCallsPerTurn: 25, repairAttempts: 3 },
  behaviour: { planApproval: true, testRun: true, shortReasoning: true },
};
