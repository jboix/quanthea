/**
 * The endpoints of an alert thread's draft pane, for editors: a hand edit saves the person's own
 * change as a new draft version and adds a card to the conversation, which the agent reads next
 * turn; a test sends a version's message to its channels.
 */
import {
  alertSpecChanges,
  alertSpecSchema,
  handEditAlertEndpoint,
  type Principal,
  type SpecChange,
  testAlertEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Alerts } from '../../alerts/alerts.ts';
import { AppError } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { checkThread } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the draft pane's endpoints need. */
export interface AlertDraftRouteServices {
  /** The threads, for the conversation. */
  readonly threads: Threads;
  /** The alerts. */
  readonly alerts: Alerts;
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
 * The note of a hand edit: the fields it changed.
 *
 * @param changes - The changes.
 * @returns Such as `By hand: condition.value, for`.
 */
function noteOf(changes: readonly SpecChange[]): string {
  return `By hand: ${changes.map((change) => change.path).join(', ')}`.slice(0, 200);
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
  const note = body.note ?? noteOf(changes);
  const input = { alertId: draft.alertId, spec: body.spec, note, threadId };
  const { version } = services.alerts.saveVersion(input, actorOf(principal));
  const data = { alertId: draft.alertId, from: draft.version, to: version, changes };
  const message = { id: `hand-${newId()}`, role: 'user', parts: [{ type: 'data-handEdit', data }] };
  const { messages } = services.threads.get(threadId);
  services.threads.saveMessages(threadId, [...(messages as never[]), message], actorOf(principal));
  return { alertId: draft.alertId, version, changes };
}

/**
 * Mounts the draft pane's endpoints.
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
