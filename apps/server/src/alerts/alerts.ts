/**
 * The alerts service: read alerts with their state, save and activate versions, mute, replay, and
 * list what the evaluator runs. People are named by user id; the routes name them.
 */
import {
  type AlertDetail,
  type AlertListItem,
  type AlertReplay,
  type AlertSummary,
  alertSpecSchema,
  type NotifiedSeries,
  type Principal,
  type Role,
} from '@quanthea/shared';
import { refuseSpec } from '../dashboards/context.ts';
import type { AlertRow, AlertVersionRow } from '../db/alert-repository.ts';
import { AppError } from '../lib/errors.ts';
import {
  type AlertsContext,
  type AlertsDependencies,
  activate,
  alertOrThrow,
  mute,
  type NewVersion,
  saveVersion,
  unmute,
} from './changes.ts';
import { type AlertCheck, checkAlert } from './check.ts';
import { deactivate } from './deactivate.ts';
import type { EvaluatedAlert } from './evaluate.ts';
import { detailExtras, noActivity, toListItem } from './listing.ts';
import { type ReplayRequest, replayAlert } from './replay.ts';
import { sendTest } from './test-send.ts';
import { validateAlertSpec } from './validate.ts';
import {
  canSeeAlert,
  canSeeVersion,
  countStates,
  type StateCounts,
  toDetail,
  toSummary,
} from './views.ts';

/** How many changes of state an alert's detail lists. */
const recentEvents = 200;

/** How long the changes of state are kept: 90 days. */
const eventsKeptMs = 90 * 86_400_000;

/** The alerts service. */
export interface Alerts {
  /**
   * Lists the alerts the role may see, with how many series are in each state, the series that
   * stands for each, and the latest message sent about it.
   *
   * @param role - The role of the reader.
   * @returns The alerts, the newest first.
   */
  list(role: Role): AlertListItem[];
  /**
   * Reads an alert with its versions, series and recent changes of state.
   *
   * @param id - The alert.
   * @param role - The role of the reader: viewers and analysts see the versions ever active.
   * @returns The alert.
   * @throws {AppError} `not_found`, also for an alert never activated below editor.
   */
  get(id: string, role: Role): AlertDetail;
  /**
   * Checks a spec and runs its query once, for the caller that writes it.
   *
   * @param spec - The spec, as JSON.
   * @returns The spec with the series it sees now, or the issues.
   */
  check(spec: unknown): Promise<AlertCheck>;
  /**
   * Saves a new version from a spec, creating the alert when none is named.
   *
   * @param input - The alert, the spec, a note and the thread.
   * @param actor - Who saves.
   * @returns The alert and the version number.
   */
  saveVersion(input: NewVersion, actor: string): { alertId: string; version: number };
  /**
   * Activates a version.
   *
   * @param id - The alert.
   * @param version - The version.
   * @param actor - Who activates.
   * @returns The alert.
   */
  activate(id: string, version: number, actor: string): Promise<AlertSummary>;
  /**
   * Stops evaluating an alert.
   *
   * @param id - The alert.
   * @param actor - Who deactivates.
   * @returns The alert.
   */
  deactivate(id: string, actor: string): Promise<AlertSummary>;
  /**
   * Mutes an alert's notifications.
   *
   * @param id - The alert.
   * @param until - The end, or `null` until someone unmutes (editors only).
   * @param principal - Who mutes.
   * @returns The alert.
   */
  mute(id: string, until: number | null, principal: Principal): AlertSummary;
  /**
   * Unmutes an alert.
   *
   * @param id - The alert.
   * @param principal - Who unmutes.
   * @returns The alert.
   */
  unmute(id: string, principal: Principal): AlertSummary;
  /**
   * Replays a spec, such as a draft, over a past window.
   *
   * @param spec - The spec, as JSON.
   * @param request - The window and the step.
   * @returns The replay.
   */
  replaySpec(spec: unknown, request: ReplayRequest): Promise<AlertReplay>;
  /**
   * Replays a saved version over a past window.
   *
   * @param id - The alert.
   * @param version - The version.
   * @param request - The window and the step.
   * @param role - The role of the reader: below editor, only a version ever active replays.
   * @returns The replay.
   * @throws {AppError} `not_found` for a version the role may not see.
   */
  replayVersion(
    id: string,
    version: number,
    request: ReplayRequest,
    role: Role,
  ): Promise<AlertReplay>;
  /**
   * Sends a version's message to its channels as a test, `alert.test`.
   *
   * @param id - The alert.
   * @param version - The version.
   * @param series - The series the message is about; a stand-in when left out.
   * @param actor - Who sends it.
   * @returns Each channel's result.
   */
  sendTest(
    id: string,
    version: number,
    series: NotifiedSeries | undefined,
    actor: string,
  ): Promise<unknown>;
  /**
   * Lists the alerts to evaluate: active and not deactivated, with their active spec.
   *
   * @returns The alerts. One whose stored spec no longer parses is left out.
   */
  evaluated(): EvaluatedAlert[];
  /**
   * Deletes the changes of state older than 90 days.
   *
   * @returns How many it deleted.
   */
  purgeEvents(): number;
}

/**
 * Summarizes an alert with its severity and state counts.
 *
 * @param context - The service context.
 * @param alert - The alert.
 * @param role - The role of the reader: drafts show to editors only.
 * @param counts - How many series it has in each state.
 * @returns The summary.
 */
function summaryOf(
  context: AlertsContext,
  alert: AlertRow,
  role: Role,
  counts?: StateCounts,
): AlertSummary {
  const shown = shownVersion(context, alert);
  return toSummary(alert, shown, role, counts ?? context.states.stateCounts().get(alert.id));
}

/**
 * The version that sets what an alert shows: the active one, else the latest.
 *
 * @param context - The service context.
 * @param alert - The alert.
 * @returns The version.
 * @throws {AppError} `not_found` when it has none.
 */
function shownVersion(context: AlertsContext, alert: AlertRow): AlertVersionRow {
  const shown = context.repository.version(alert.id, alert.activeVersion ?? alert.latestVersion);
  if (!shown) throw new AppError('not_found', `No alert ${alert.id}.`);
  return shown;
}

/**
 * Reads an alert the role may see, with its detail.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param role - The role.
 * @returns The detail.
 * @throws {AppError} `not_found`.
 */
function detailOf(context: AlertsContext, id: string, role: Role): AlertDetail {
  const alert = alertOrThrow(context, id);
  if (!canSeeAlert(alert, role)) throw new AppError('not_found', `No alert ${id}.`);
  const shown = shownVersion(context, alert);
  const spec = alertSpecSchema.parse(shown.spec);
  const series = context.states.series(id);
  const activity = context.activity ?? noActivity;
  const summary = toSummary(alert, shown, role, countStates(series));
  const item = toListItem(summary, spec, series, activity.sends(id, 1)[0]);
  const parts = {
    versions: context.repository.versions(id),
    series,
    events: context.states.events(id, recentEvents),
  };
  return { ...toDetail(item, parts, role), ...detailExtras(activity, id, spec) };
}

/**
 * Reads a version the role may replay.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param version - The version.
 * @param role - The role: below editor, only a version ever active of an alert shown.
 * @returns The version.
 * @throws {AppError} `not_found` for a version the role may not see.
 */
function replayedVersion(
  context: AlertsContext,
  id: string,
  version: number,
  role: Role,
): AlertVersionRow {
  const alert = alertOrThrow(context, id);
  const row = context.repository.version(alert.id, version);
  if (!row || !canSeeAlert(alert, role) || !canSeeVersion(row, role))
    throw new AppError('not_found', `Alert ${id} has no version ${version}.`);
  return row;
}

/**
 * Validates a spec for a replay.
 *
 * @param context - The service context.
 * @param spec - The spec, as JSON.
 * @returns The valid spec.
 * @throws {AppError} `bad_request` with the issues.
 */
function replayable(context: AlertsContext, spec: unknown) {
  const validation = validateAlertSpec(spec, { lookup: context.lookup, now: context.now() });
  if (!validation.ok) refuseSpec('The alert spec is invalid.', validation.issues);
  return validation.spec;
}

/**
 * Lists the alerts to evaluate, leaving out a spec that no longer parses.
 *
 * @param context - The service context.
 * @returns The alerts with their specs.
 */
function evaluatedAlerts(context: AlertsContext): EvaluatedAlert[] {
  return context.repository.evaluated().flatMap(({ alert, spec }) => {
    const parsed = alertSpecSchema.safeParse(spec);
    return parsed.success ? [{ alert, spec: parsed.data }] : [];
  });
}

/**
 * Creates the alerts service.
 *
 * @param dependencies - The stores, the audit log, the connectors, the settings and the clock.
 * @returns The service.
 */
export function createAlerts(dependencies: AlertsDependencies): Alerts {
  const context: AlertsContext = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    list: (role) => listAlerts(context, role),
    get: (id, role) => detailOf(context, id, role),
    check: (spec) => checkAlert(context, spec, context.now()),
    ...changeMethods(context),
    replaySpec: async (spec, request) => replayAlert(context, replayable(context, spec), request),
    replayVersion: async (id, version, request, role) => {
      const row = replayedVersion(context, id, version, role);
      return replayAlert(context, replayable(context, row.spec), request);
    },
    sendTest: (id, version, series, actor) => sendTest(context, id, version, series, actor),
    evaluated: () => evaluatedAlerts(context),
    purgeEvents: () => context.states.purgeEvents(context.now() - eventsKeptMs),
  };
}

/**
 * Lists the alerts a role may see.
 *
 * @param context - The service context.
 * @param role - The role.
 * @returns The summaries.
 */
function listAlerts(context: AlertsContext, role: Role): AlertListItem[] {
  const lastSends = (context.activity ?? noActivity).lastSends();
  return context.repository
    .list()
    .filter((alert) => canSeeAlert(alert, role))
    .map((alert) => {
      const shown = shownVersion(context, alert);
      const series = context.states.series(alert.id);
      const summary = toSummary(alert, shown, role, countStates(series));
      const spec = alertSpecSchema.parse(shown.spec);
      return toListItem(summary, spec, series, lastSends.get(alert.id));
    });
}

/**
 * The methods that change alerts, each returning the alert's summary after the change.
 *
 * @param context - The service context.
 * @returns The methods.
 */
function changeMethods(
  context: AlertsContext,
): Pick<Alerts, 'saveVersion' | 'activate' | 'deactivate' | 'mute' | 'unmute'> {
  const summary = (id: string, role: Role = 'editor') =>
    summaryOf(context, alertOrThrow(context, id), role);
  return {
    saveVersion: (input, actor) => saveVersion(context, input, actor),
    activate: async (id, version, actor) => {
      await activate(context, id, version, actor);
      return summary(id);
    },
    deactivate: async (id, actor) => {
      await deactivate(context, id, actor);
      return summary(id);
    },
    mute: (id, until, principal) => {
      mute(context, id, until, principal);
      return summary(id, principal.role);
    },
    unmute: (id, principal) => {
      unmute(context, id, principal.id);
      return summary(id, principal.role);
    },
  };
}
