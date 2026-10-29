/**
 * The endpoints of hand edits in a dashboard thread, for editors: the owner of the thread or an
 * admin changes one draft panel from the inspector. A test run checks the panel and runs its
 * queries; a save does the same, adds a version, and adds the hand-edit card with the diff to the
 * conversation, which the agent reads next turn.
 */
import {
  type DashboardSpec,
  diffSpecs,
  handEditPanelEndpoint,
  type PanelEdit,
  type Principal,
  testPanelEditEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import { checkHandEdit } from '../../dashboards/hand-edit.ts';
import { AppError } from '../../lib/errors.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { checkOwnerChange, checkThread } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';
import { addCard } from './alert-draft-routes.ts';

/** What the dashboard hand edits need. */
export interface DashboardDraftRouteServices {
  /** The threads, for the conversation. */
  readonly threads: Threads;
  /** The dashboards. */
  readonly dashboards: Pick<Dashboards, 'get' | 'getVersion' | 'check' | 'testRun' | 'addVersion'>;
}

/** A hand edit's path: the thread and the panel. */
interface EditTarget {
  /** The thread. */
  readonly threadId: string;
  /** The panel. */
  readonly panelId: string;
}

/**
 * The thread's dashboard and its latest version, which the edit must start from.
 *
 * @param services - The threads and dashboards.
 * @param threadId - The thread.
 * @param basedOn - The version the edit starts from.
 * @returns The dashboard id, the version and its spec.
 * @throws {AppError} `bad_request` for a thread without a draft, `conflict` for an older version.
 */
function latestDraft(services: DashboardDraftRouteServices, threadId: string, basedOn: number) {
  const { kind, dashboardId } = services.threads.row(threadId);
  if (kind !== 'dashboard' || dashboardId === null)
    throw new AppError('bad_request', 'This thread has no dashboard draft yet.');
  const version = services.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version ?? 0;
  if (version !== basedOn)
    throw new AppError('conflict', `The draft is at v${version} now. Edit the latest version.`);
  const { spec } = services.dashboards.getVersion(dashboardId, version, 'editor');
  return { dashboardId, version, spec };
}

/**
 * Checks the person may edit the thread's draft (its owner or an admin), and checks and test-runs the edited panel.
 *
 * @param services - The threads and dashboards.
 * @param target - The thread and the panel.
 * @param body - The edit.
 * @param principal - Who edits.
 * @returns The draft the edit starts from, and the checked edit.
 */
async function checked(
  services: DashboardDraftRouteServices,
  target: EditTarget,
  body: PanelEdit,
  principal: Principal,
) {
  checkThread(services.threads, principal, target.threadId, 'read');
  checkOwnerChange(principal, { ownerId: services.threads.row(target.threadId).createdBy });
  const draft = latestDraft(services, target.threadId, body.basedOn);
  const input = { current: draft.spec, panelId: target.panelId, ...body };
  return { draft, edit: await checkHandEdit(services.dashboards, input) };
}

/**
 * Saves a hand-edited panel as a new version, and adds the hand-edit card to the conversation.
 *
 * @param services - The threads and dashboards.
 * @param target - The thread and the panel.
 * @param body - The edit.
 * @param principal - Who edits.
 * @returns The dashboard, the new version and what changed.
 * @throws {AppError} `bad_request` with the issues when the panel fails, or when nothing changed.
 */
async function handEdit(
  services: DashboardDraftRouteServices,
  target: EditTarget,
  body: PanelEdit,
  principal: Principal,
) {
  const { draft, edit } = await checked(services, target, body, principal);
  if (!edit.spec) {
    const { issues, queries } = edit.outcome;
    const failing = queries.flatMap((query) =>
      query.error === undefined ? [] : [{ path: `query ${query.refId}`, message: query.error }],
    );
    throw new AppError('bad_request', 'The panel does not work.', [...issues, ...failing]);
  }
  const panels = changedPanels(draft.spec, edit.spec);
  if (panels.length === 0) throw new AppError('bad_request', 'Nothing changed.');
  const title = edit.spec.panels.find((panel) => panel.id === target.panelId)?.title;
  const summary = `edited ${title ?? target.panelId} by hand`;
  const actor = actorOf(principal);
  const version = services.dashboards.addVersion(draft.dashboardId, edit.spec, summary, actor);
  const data = { dashboardId: draft.dashboardId, from: draft.version, to: version, panels };
  addCard(services.threads, target.threadId, { type: 'data-dashboardHandEdit', data }, actor);
  return { dashboardId: draft.dashboardId, version, panels };
}

/**
 * The panels that changed from one spec to the next, as the card shows them.
 *
 * @param before - The spec before.
 * @param after - The spec after.
 * @returns The changed panels, missing values left out.
 */
function changedPanels(before: DashboardSpec, after: DashboardSpec) {
  return diffSpecs(before, after)
    .panels.filter((panel) => panel.status !== 'same')
    .map((panel) => ({
      ...panel,
      changes: panel.changes.map(({ path, before: was, after: now }) => ({
        path,
        ...(was === undefined ? {} : { before: was }),
        ...(now === undefined ? {} : { after: now }),
      })),
    }));
}

/**
 * Mounts the dashboard hand edits' endpoints.
 *
 * @param app - The app.
 * @param services - The threads and dashboards.
 */
export function mountDashboardDraftEndpoints(
  app: Hono<AppEnv>,
  services: DashboardDraftRouteServices,
) {
  mountEndpoint(app, testPanelEditEndpoint, {
    access: 'editor',
    handle: async ({ params, body, principal }) =>
      (await checked(services, params, body, signedIn(principal))).edit.outcome,
  });
  mountEndpoint(app, handEditPanelEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => handEdit(services, params, body, signedIn(principal)),
  });
}
