/**
 * The metadata model, at pin time: a one-line description and a few tags that help people find a
 * dashboard in the library. It is best effort: when the model is not set up, fails or is slow, the
 * dashboard is pinned without them.
 */
import type { DashboardSpec } from '@querent/shared';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { ModelSettingsService } from '../settings/model-settings.ts';
import type { Usage } from '../usage/usage.ts';
import { languageModel, modelIdFor, reasoningOption } from './model.ts';
import { tokensOf } from './usage.ts';

/** What the metadata model writes for a pinned dashboard. */
export interface PinMetadata {
  /** One line on what the dashboard shows. */
  readonly description: string;
  /** Three to six lowercase tags. */
  readonly tags: readonly string[];
}

/** What the metadata writer needs. */
export interface MetadataDependencies {
  /** The model settings, for the provider and its key. */
  readonly modelSettings: Pick<ModelSettingsService, 'resolve'>;
  /** The usage ledger, where the call's tokens go. */
  readonly usage: Pick<Usage, 'recordStep'>;
  /** Builds a model; the real providers by default. Tests pass a fake. */
  readonly buildModel?: typeof languageModel;
}

/** The dashboard a pin describes, and where the call's usage belongs. */
export interface MetadataRequest {
  /** The spec being pinned. */
  readonly spec: DashboardSpec;
  /** The dashboard's thread, if it has one: its provider is used, and its usage recorded. */
  readonly threadId: string | null;
  /** That thread's provider; the default when `null`. */
  readonly providerId: string | null;
}

/** The longest the call may take, in milliseconds, so pinning never waits long. */
const timeoutMs = 20_000;

/** What the model answers. */
const answerSchema = z.object({
  description: z.string().describe('One sentence, at most 160 characters.'),
  tags: z.array(z.string()).describe('3 to 6 short lowercase tags.'),
});

/**
 * The prompt: the dashboard's title, description and panels, with their connectors. The spec was
 * written by the model, so nothing here is data it has not seen.
 *
 * @param spec - The spec.
 * @returns The prompt.
 */
function promptOf(spec: DashboardSpec): string {
  const panels = spec.panels.map((panel) => {
    const connectors = [...new Set(panel.queries.map((query) => query.connector))].join(', ');
    return `- ${panel.title}${panel.description ? `: ${panel.description}` : ''} (${connectors})`;
  });
  return [
    'Describe this dashboard for a library where people search for dashboards.',
    'Write one sentence on what it shows, and 3 to 6 tags: the services, systems and signals it',
    'is about, as single lowercase words or hyphenated words.',
    '',
    `Title: ${spec.title}`,
    ...(spec.description ? [`Description: ${spec.description}`] : []),
    'Panels:',
    ...panels,
  ].join('\n');
}

/**
 * Cleans the tags: lowercase words and hyphens, no repeats, at most six.
 *
 * @param tags - The tags the model wrote.
 * @returns The tags.
 */
export function cleanTags(tags: readonly string[]): string[] {
  const cleaned = tags.map((tag) =>
    tag
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30),
  );
  return [...new Set(cleaned.filter((tag) => tag.length >= 2))].slice(0, 6);
}

/**
 * Creates the metadata writer.
 *
 * @param dependencies - The model settings, the usage ledger and the model builder.
 * @returns Writes the metadata of a dashboard being pinned; `null` when the model could not.
 */
export function createMetadataWriter(dependencies: MetadataDependencies) {
  const build = dependencies.buildModel ?? languageModel;
  return async (request: MetadataRequest): Promise<PinMetadata | null> => {
    try {
      const resolved = await dependencies.modelSettings.resolve(request.providerId);
      const result = await generateText({
        ...reasoningOption(resolved.settings),
        model: build(resolved, 'metadata'),
        maxRetries: 1,
        timeout: timeoutMs,
        prompt: promptOf(request.spec),
        output: Output.object({ schema: answerSchema }),
      });
      dependencies.usage.recordStep({
        threadId: request.threadId,
        provider: resolved.providerName,
        model: modelIdFor(resolved.settings, 'metadata'),
        job: 'metadata',
        tokens: tokensOf(result.usage),
      });
      const { description, tags } = result.output;
      return { description: description.trim().slice(0, 200), tags: cleanTags(tags) };
    } catch {
      return null;
    }
  };
}
