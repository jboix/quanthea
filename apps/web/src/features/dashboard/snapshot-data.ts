/**
 * Snapshots from the dashboard screen: take one of the version shown, list the dashboard's live
 * snapshots, and revoke one. The browser sends the version and the choices; the server runs the
 * panels.
 */
import {
  listDashboardSnapshotsEndpoint,
  revokeSnapshotEndpoint,
  type SnapshotLifetime,
  type SnapshotSummary,
  type TimeRangeExpression,
  takeSnapshotEndpoint,
  type VariableValues,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/** What the dashboard screen submits about snapshots, as JSON. */
export type SnapshotIntent =
  | {
      readonly intent: 'snapshot';
      readonly version: number;
      readonly lifetime: SnapshotLifetime;
      readonly variables: VariableValues;
      readonly time?: TimeRangeExpression | undefined;
      readonly hiddenMarkers: readonly string[];
    }
  | { readonly intent: 'revoke'; readonly snapshotId: string };

/**
 * Takes a snapshot or revokes one.
 *
 * @param api - The API client.
 * @param dashboardId - The dashboard.
 * @param intent - What to do.
 * @returns The snapshot taken, or nothing once revoked; or why it failed.
 */
export function runSnapshotIntent(
  api: ApiClient,
  dashboardId: string,
  intent: SnapshotIntent,
): Promise<Loaded<SnapshotSummary | null>> {
  if (intent.intent === 'revoke') {
    const params = { snapshotId: intent.snapshotId };
    return loaded(api.call(revokeSnapshotEndpoint, { params }).then(() => null));
  }
  const { version, lifetime, variables, time, hiddenMarkers } = intent;
  const body = { dashboardId, version, lifetime, variables, hiddenMarkers: [...hiddenMarkers] };
  return loaded(api.call(takeSnapshotEndpoint, { body: time ? { ...body, time } : body }));
}

/**
 * The loader of a dashboard's snapshots resource route, for the snapshot menu.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadDashboardSnapshots(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<SnapshotSummary[]>> => {
    const input = { params: { dashboardId: params.dashboardId ?? '' } };
    const call = api.call(listDashboardSnapshotsEndpoint, input, { signal: request.signal });
    return loaded(call.then((result) => result.snapshots));
  };
}
