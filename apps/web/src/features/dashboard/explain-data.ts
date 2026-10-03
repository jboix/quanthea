/**
 * The loader of a panel's explanation, for the panel's info bubble: the latest explanation, and
 * whether one is being written. It loads through a fetcher when the bubble opens.
 */
import { getPanelExplanationEndpoint, type PanelExplanation } from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/** A panel's latest explanation, and whether one is being written. */
export interface ExplanationState {
  /** The latest explanation, or `null`. */
  readonly explanation: PanelExplanation | null;
  /** Whether someone is asking for one now. */
  readonly generating: boolean;
}

/**
 * The loader of a panel's latest explanation.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadExplanation(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<ExplanationState>> => {
    const panel = {
      dashboardId: params.dashboardId ?? '',
      version: params.version ?? '',
      panelId: params.panelId ?? '',
    };
    return loaded(
      api.call(getPanelExplanationEndpoint, { params: panel }, { signal: request.signal }),
    );
  };
}
