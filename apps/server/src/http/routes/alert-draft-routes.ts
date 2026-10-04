/**
 * The endpoints of hand edits, for editors. A hand edit in an alert thread's draft pane saves the
 * person's own change as a new draft version; changes made on a live alert's page are saved as a
 * new version and activated. Either adds a card to the conversation that wrote the alert, which
 * the agent reads next turn. A test sends a version's message to its channels.
 */
import {
  activateAlertChangesEndpoint,
  alertSpecChanges,
  alertSpecSchema,
  handEditAlertEndpoint,
  type Principal,
  type SpecChange,
  testAlertEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Alerts } from '../../alerts/alerts.ts';
import { type ActiveChange, handEditNote } from '../../alerts/changes.ts';
import { AppError } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { checkThread } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the hand edits' endpoints need. */
export interface AlertDraftRouteServices {
  /** The threads, for the conversation. */
  readonly threads: Threads;
  /** The alerts. */
  readonly alerts: Alerts;
}

/** A hand edit, as its card in the conversation shows it. */
interface HandEdit {
  /** The alert. */
  readonly alertId: string;
  /** The version it started from. */
  readonly from: number;
  /** The version it saved. */
  readonly to: number;
  /** The fields that changed. */
  readonly changes: readonly SpecChange[];
}

/**
 * The thread's alert and its latest version.
 *
 * @param services - The threads and alerts.
 * @param threadId - The thread.
 * @returns The alert id, the version and its spec.
 * @throws {AppError} `bad_request` for a thread without an alert draft.
 */
function latestDraft(services: AlertDraftRouteServices, threadId: string) {
  const { kind, alertId } = services.threads.row(threadId);
  if (kind !== 'alert' || alertId === null)
    throw new AppError('bad_request', 'This thread has no alert draft yet.');
  const [latest] = services.alerts.get(alertId, 'editor').versions;
  if (!latest) throw new AppError('bad_request', 'This thread has no alert draft yet.');
  return { alertId, version: latest.version, spec: latest.spec };
}

/**
 * Adds the hand-edit card to a conversation, as a message of the person who made it.
 *
 * @param threads - The threads.
 * @param threadId - The conversation.
 * @param data - The versions and the changes.
 * @param actor - Who made it.
 */
function addCard(threads: Threads, threadId: string, data: HandEdit, actor: string): void {
  const message = { id: `hand-${newId()}`, role: 'user', parts: [{ type: 'data-handEdit', data }] };
  const { messages } = threads.get(threadId);
  threads.saveMessages(threadId, [...(messages as never[]), message], actor);
}

/**
 * Saves a hand edit as a new version, and adds the hand-edit card to the conversation.
 *
 * @param services - The threads and alerts.
 * @param threadId - The thread.
 * @param body - The whole spec and a note.
 * @param principal - Who edits.
 * @returns The alert, the new version and the changes.
 * @throws {AppError} `bad_request` when nothing changed or the spec is invalid.
 */
function handEdit(
  services: AlertDraftRouteServices,
  threadId: string,
  body: { readonly spec: unknown; readonly note?: string | undefined },
  principal: Principal,
) {
  checkThread(services.threads, principal, threadId, 'write');
  const draft = latestDraft(services, threadId);
  const parsed = alertSpecSchema.safeParse(body.spec);
  const changes = alertSpecChanges(draft.spec, parsed.success ? parsed.data : body.spec);
  if (changes.length === 0) throw new AppError('bad_request', 'Nothing changed.');
  const note = body.note ?? handEditNote(changes);
  const input = { alertId: draft.alertId, spec: body.spec, note, threadId };
  const { version } = services.alerts.saveVersion(input, actorOf(principal));
  const data = { alertId: draft.alertId, from: draft.version, to: version, changes };
  addCard(services.threads, threadId, data, actorOf(principal));
  return { alertId: draft.alertId, version, changes };
}

/**
 * Saves changes made on a live alert's page as a new version and activates it. When a
 * conversation wrote the alert and is not in the bin, it gets the hand-edit card.
 *
 * @param services - The threads and alerts.
 * @param alertId - The alert.
 * @param change - The active version it starts from, the changed spec and a note.
 * @param actor - Who changes it.
 * @returns The alert, the new version and the changes.
 */
async function activateChanges(
  services: AlertDraftRouteServices,
  alertId: string,
  change: ActiveChange,
  actor: string,
) {
  const { threadId } = services.alerts.get(alertId, 'editor');
  const { version, changes } = await services.alerts.activateChange(alertId, change, actor);
  const data = { alertId, from: change.basedOn, to: version, changes };
  if (threadId !== null && isOpen(services.threads, threadId))
    addCard(services.threads, threadId, data, actor);
  return { alertId, version, changes };
}

/**
 * Whether a thread is open: neither in the bin nor deleted for good.
 *
 * @param threads - The threads.
 * @param threadId - The thread.
 * @returns Whether it is open.
 */
function isOpen(threads: Threads, threadId: string): boolean {
  try {
    threads.row(threadId);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return false;
    throw error;
  }
}

/**
 * Mounts the hand edits' endpoints.
 *
 * @param app - The app.
 * @param services - The threads and alerts.
 */
export function mountAlertDraftEndpoints(app: Hono<AppEnv>, services: AlertDraftRouteServices) {
  mountEndpoint(app, handEditAlertEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      handEdit(services, params.threadId, body, signedIn(principal)),
  });
  mountEndpoint(app, activateAlertChangesEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      activateChanges(services, params.alertId, body, actorOf(principal)),
  });
  mountEndpoint(app, testAlertEndpoint, {
    access: 'editor',
    handle: async ({ params, body, principal }) => {
      const version = Number(params.version);
      const actor = actorOf(principal);
      const results = await services.alerts.sendTest(params.alertId, version, body.series, actor);
      return { results: results as never };
    },
  });
}
