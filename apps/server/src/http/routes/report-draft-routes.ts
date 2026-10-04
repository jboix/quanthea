/**
 * The endpoint of hand edits in a report thread, for editors: a change the person makes in the
 * draft pane (the weekday, the time, the time zone, the period, the comparison) is saved as a new
 * draft version, and the conversation gets the "You changed it by hand" card, which the agent
 * reads next turn.
 */
import {
  alertSpecChanges,
  handEditReportEndpoint,
  type Principal,
  reportSpecSchema,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import { handEditNote } from '../../alerts/changes.ts';
import { AppError } from '../../lib/errors.ts';
import type { Reports } from '../../reports/reports.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { checkThread } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';
import { addCard } from './alert-draft-routes.ts';

/** What the report hand edits need. */
export interface ReportDraftRouteServices {
  /** The threads, for the conversation. */
  readonly threads: Threads;
  /** The reports. */
  readonly reports: Pick<Reports, 'get' | 'saveVersion'>;
}

/**
 * The thread's report and its latest version.
 *
 * @param services - The threads and reports.
 * @param threadId - The thread.
 * @returns The report id, the version and its spec.
 * @throws {AppError} `bad_request` for a thread without a report draft.
 */
function latestDraft(services: ReportDraftRouteServices, threadId: string) {
  const { kind, reportId } = services.threads.row(threadId);
  if (kind !== 'report' || reportId === null)
    throw new AppError('bad_request', 'This thread has no report draft yet.');
  const latest = services.reports
    .get(reportId, 'editor')
    .versions.reduce<{ version: number; spec: unknown } | undefined>(
      (found, each) => (found && found.version > each.version ? found : each),
      undefined,
    );
  if (!latest) throw new AppError('bad_request', 'This thread has no report draft yet.');
  return { reportId, version: latest.version, spec: latest.spec };
}

/**
 * Saves a hand edit as a new version, and adds the hand-edit card to the conversation.
 *
 * @param services - The threads and reports.
 * @param threadId - The thread.
 * @param body - The whole spec and a note.
 * @param principal - Who edits.
 * @returns The report, the new version and the changes.
 * @throws {AppError} `bad_request` when nothing changed or the spec is invalid.
 */
function handEdit(
  services: ReportDraftRouteServices,
  threadId: string,
  body: { readonly spec: unknown; readonly note?: string | undefined },
  principal: Principal,
) {
  checkThread(services.threads, principal, threadId, 'write');
  const draft = latestDraft(services, threadId);
  const parsed = reportSpecSchema.safeParse(body.spec);
  const changes = alertSpecChanges(draft.spec, parsed.success ? parsed.data : body.spec);
  if (changes.length === 0) throw new AppError('bad_request', 'Nothing changed.');
  const note = body.note ?? handEditNote(changes);
  const input = { reportId: draft.reportId, spec: body.spec, note, threadId };
  const { version } = services.reports.saveVersion(input, actorOf(principal));
  const data = { reportId: draft.reportId, from: draft.version, to: version, changes };
  addCard(services.threads, threadId, { type: 'data-reportHandEdit', data }, actorOf(principal));
  return { reportId: draft.reportId, version, changes };
}

/**
 * Mounts the report hand edits' endpoint.
 *
 * @param app - The app.
 * @param services - The threads and reports.
 */
export function mountReportDraftEndpoints(app: Hono<AppEnv>, services: ReportDraftRouteServices) {
  mountEndpoint(app, handEditReportEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      handEdit(services, params.threadId, body, signedIn(principal)),
  });
}
