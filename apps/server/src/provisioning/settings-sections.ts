/**
 * Settings sections in the configuration file: `model`, `retention`, `charts` and `queries`, each
 * with the API's fields. A section is managed as a whole. The model gateway's API keys are secrets:
 *
 * ```yaml
 * model:
 *   defaultProviderId: anthropic
 *   providers:
 *     - { id: anthropic, name: Anthropic, provider: anthropic, baseUrl: null,
 *         models: { build: claude-sonnet-5, plan: '', repair: '', metadata: '' },
 *         apiKey: ${ANTHROPIC_API_KEY} }
 * ```
 */
import {
  chartSettingsSchema,
  defaultModelSettings,
  modelGatewaySchema,
  querySettingsSchema,
  retentionSettingsSchema,
} from '@querent/shared';
import type { z } from 'zod';
import type { ConfigFile } from '../config/config-file.ts';
import type { ChartSettingsService } from '../settings/chart-settings.ts';
import type { ModelSettingsService } from '../settings/model-settings.ts';
import type { QuerySettingsService } from '../settings/query-settings.ts';
import type { RetentionSettingsService } from '../settings/retention-settings.ts';
import { type Applier, type Planned, provisioningActor } from './reconcile.ts';
import { secretValue } from './secret-references.ts';

/** The settings sections the file may hold. */
export const settingsSections = ['model', 'retention', 'charts', 'queries'] as const;

/** A settings section. */
type SettingsSection = (typeof settingsSections)[number];

/** A section ready to apply: its value, and the model's API keys. */
interface DesiredSection {
  /** The section's settings. */
  readonly value: unknown;
  /** The API keys by model provider id. */
  readonly apiKeys: Readonly<Record<string, string>>;
}

/** The schema of each section as the file declares it. */
const schemas: Readonly<Record<SettingsSection, z.ZodType>> = {
  model: modelGatewaySchema,
  retention: retentionSettingsSchema,
  charts: chartSettingsSchema,
  queries: querySettingsSchema,
};

/** The services that store the sections. */
export interface SettingsServices {
  /** The model gateway. */
  readonly modelSettings: ModelSettingsService;
  /** The retention settings. */
  readonly retention: RetentionSettingsService;
  /** The chart settings. */
  readonly chartSettings: ChartSettingsService;
  /** The query settings. */
  readonly querySettings: QuerySettingsService;
}

/**
 * The model gateway's API keys, taken out of its providers.
 *
 * @param file - The configuration file.
 * @param declared - The model section, interpolated.
 * @param issues - Collects what is wrong.
 * @returns The section without keys, and the keys by provider id.
 */
function modelKeys(file: ConfigFile, declared: Record<string, unknown>, issues: string[]) {
  const written = (file.raw.model?.providers ?? []) as Record<string, unknown>[];
  const providers = Array.isArray(declared.providers) ? declared.providers : [];
  const apiKeys: Record<string, string> = {};
  const stripped = providers.map((each: Record<string, unknown>, index: number) => {
    const { apiKey, ...rest } = each;
    const where = `model.providers.${index}.apiKey`;
    const key =
      apiKey === undefined ? undefined : secretValue(written[index]?.apiKey, apiKey, where, issues);
    if (key !== undefined) apiKeys[String(rest.id)] = key;
    return rest;
  });
  const { limits, behaviour } = defaultModelSettings;
  return { value: { limits, behaviour, ...declared, providers: stripped }, apiKeys };
}

/**
 * One section as declared, checked.
 *
 * @param file - The configuration file.
 * @param section - The section.
 * @param issues - Collects what is wrong.
 * @returns The section, or `undefined` when the file leaves it out or it is invalid.
 */
function planOne(
  file: ConfigFile,
  section: SettingsSection,
  issues: string[],
): Planned<DesiredSection> | undefined {
  const declared = file.sections[section];
  if (!declared) return undefined;
  const path = Object.entries(file.origins).find(([key]) => key.startsWith(`${section}.`))?.[1];
  const { value, apiKeys } =
    section === 'model'
      ? modelKeys(file, { ...declared }, issues)
      : { value: declared, apiKeys: {} };
  const parsed = schemas[section].safeParse(value);
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((issue) => `${section}.${issue.path.join('.')}: ${issue.message}`),
    );
    return undefined;
  }
  return {
    name: section,
    path: path ?? '',
    desired: { value: parsed.data, apiKeys },
    editable: [],
  };
}

/**
 * The settings sections the file declares, checked.
 *
 * @param file - The configuration file.
 * @param issues - Collects what is wrong.
 * @returns The sections.
 */
export function planSettings(file: ConfigFile, issues: string[]): Planned<DesiredSection>[] {
  return settingsSections.flatMap((section) => {
    const planned = planOne(file, section, issues);
    return planned ? [planned] : [];
  });
}

/**
 * Saves one section.
 *
 * @param services - The settings services.
 * @param item - The section as declared.
 * @returns Once it is saved.
 */
async function saveSection(
  services: SettingsServices,
  item: Planned<DesiredSection>,
): Promise<void> {
  const { value, apiKeys } = item.desired;
  const actor = provisioningActor;
  if (item.name === 'model')
    await services.modelSettings.save(value as z.output<typeof modelGatewaySchema>, apiKeys, actor);
  if (item.name === 'retention')
    services.retention.save(value as z.output<typeof retentionSettingsSchema>, actor);
  if (item.name === 'charts')
    services.chartSettings.save(value as z.output<typeof chartSettingsSchema>, actor);
  if (item.name === 'queries')
    services.querySettings.save(value as z.output<typeof querySettingsSchema>, actor);
}

/**
 * How settings sections are applied. A section the file no longer declares keeps its values, even
 * when pruning: settings have no "deleted" state.
 *
 * @param services - The settings services.
 * @returns The applier.
 */
export function settingsApplier(services: SettingsServices): Applier<DesiredSection> {
  return {
    kind: 'settings',
    exists: () => true,
    apply: (item) => saveSection(services, item),
    remove: async () => undefined,
  };
}
