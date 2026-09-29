/** Loads the query settings and guide, and saves and previews queries, through the API. */
import {
  getQueryGuideEndpoint,
  getQuerySettingsEndpoint,
  previewQueryEndpoint,
  type previewRanges,
  type QueryGuide,
  type QueryPreview,
  type QuerySettings,
  type SavedQuery,
  saveQuerySettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** A connector a preview can run on. */
export interface PreviewConnector {
  /** Its name. */
  readonly name: string;
  /** Its query language. */
  readonly language: 'sql' | 'promql';
}

/** How far back a preview looks. */
export type PreviewRange = (typeof previewRanges)[number];

/** What the queries screen shows. */
export interface QueriesData {
  /** The settings as saved. */
  readonly settings: QuerySettings;
  /** How each query builder works. */
  readonly guides: readonly QueryGuide[];
  /** The connectors a preview can run on. */
  readonly connectors: readonly PreviewConnector[];
}

/** What the queries screen submits, as JSON. */
export type QueriesIntent =
  | { readonly intent: 'save'; readonly settings: QuerySettings }
  | {
      readonly intent: 'preview';
      readonly data: Readonly<Record<string, unknown>>;
      readonly chart?: string;
      readonly saved?: SavedQuery;
      readonly from: PreviewRange;
    };

/** What the action returns. */
export type QueriesOutcome =
  | { readonly intent: 'save'; readonly ok: true; readonly settings: QuerySettings }
  | { readonly intent: 'save'; readonly ok: false; readonly message: string }
  | { readonly intent: 'preview'; readonly preview: QueryPreview };

/**
 * The loader of the queries screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadQuerySettings(api: ApiClient) {
  return async (): Promise<QueriesData> => {
    const [settings, guide] = await Promise.all([
      api.call(getQuerySettingsEndpoint),
      api.call(getQueryGuideEndpoint),
    ]);
    return { settings, guides: guide.builders, connectors: guide.connectors };
  };
}

/**
 * Saves the settings, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @param settings - The settings.
 * @returns The outcome.
 */
async function save(api: ApiClient, settings: QuerySettings): Promise<QueriesOutcome> {
  try {
    const saved = await api.call(saveQuerySettingsEndpoint, { body: settings });
    return { intent: 'save', ok: true, settings: saved };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
    return { intent: 'save', ok: false, message: error.message };
  }
}

/**
 * The action of the queries screen: save the settings, or preview one panel.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function querySettingsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<QueriesOutcome> => {
    const intent = (await request.json()) as QueriesIntent;
    if (intent.intent === 'save') return save(api, intent.settings);
    const { data, chart, saved, from } = intent;
    const body = {
      data: { ...data },
      from,
      ...(chart ? { chart: { recipe: chart } } : {}),
      ...(saved ? { saved } : {}),
    };
    return { intent: 'preview', preview: await api.call(previewQueryEndpoint, { body }) };
  };
}
