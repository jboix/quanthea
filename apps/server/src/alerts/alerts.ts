/**
 * The alerts service: read alerts with their state, save and activate versions, mute, replay, and
 * list what the evaluator runs. People are named by user id; the routes name them.
 */
import {
  type AlertDetail,
  type AlertReplay,
  type AlertSummary,
  alertSpecSchema,
  type Principal,
  type Role,
} from '@quanthea/shared';
import { refuseSpec } from '../dashboards/context.ts';
import type { AlertRow } from '../db/alert-repository.ts';
import { AppError } from '../lib/errors.ts';
import {
  type AlertsContext,
  type AlertsDependencies,
  activate,
  alertOrThrow,
  deactivate,
  mute,
  type NewVersion,
  saveVersion,
  unmute,
} from './changes.ts';
import { type AlertCheck, checkAlert } from './check.ts';
import type { EvaluatedAlert } from './evaluate.ts';
import { type ReplayRequest, replayAlert } from './replay.ts';
import { validateAlertSpec } from './validate.ts';
import { canSeeAlert, type StateCounts, toDetail, toSummary } from './views.ts';

/** How many changes of state an alert's detail lists. */
const recentEvents = 200;

/** How long the changes of state are kept: 90 days. */
const eventsKeptMs = 90 * 86_400_000;

/** The alerts service. */
export interface Alerts {
  /**
   * Lists the alerts the role may see, with how many series are in each state.
   *
   * @param role - The role of the reader.
   * @returns The alerts, the newest first.
   */
  list(role: Role): AlertSummary[];
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
  deactivate(id: string, actor: string): AlertSummary;
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
   * @param actor - Who unmutes.
   * @returns The alert.
   */
  unmute(id: string, actor: string): AlertSummary;
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
   * @returns The replay.
   */
  replayVersion(id: string, version: number, request: ReplayRequest): Promise<AlertReplay>;
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
 * @param counts - How many series it has in each state.
 * @returns The summary.
 */
function summaryOf(context: AlertsContext, alert: AlertRow, counts?: StateCounts): AlertSummary {
  const shown = context.repository.version(alert.id, alert.activeVersion ?? alert.latestVersion);
  if (!shown) throw new AppError('not_found', `No alert ${alert.id}.`);
  return toSummary(alert, shown, counts ?? context.states.stateCounts().get(alert.id));
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
  const parts = {
    versions: context.repository.versions(id),
    series: context.states.series(id),
    events: context.states.events(id, recentEvents),
  };
  return toDetail(summaryOf(context, alert), parts, role);
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
    replayVersion: async (id, version, request) => {
      const row = context.repository.version(alertOrThrow(context, id).id, version);
      if (!row) throw new AppError('not_found', `Alert ${id} has no version ${version}.`);
      return replayAlert(context, replayable(context, row.spec), request);
    },
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
function listAlerts(context: AlertsContext, role: Role): AlertSummary[] {
  const counts = context.states.stateCounts();
  return context.repository
    .list()
    .filter((alert) => canSeeAlert(alert, role))
    .map((alert) => summaryOf(context, alert, counts.get(alert.id) ?? {}));
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
  const summary = (id: string) => summaryOf(context, alertOrThrow(context, id));
  return {
    saveVersion: (input, actor) => saveVersion(context, input, actor),
    activate: async (id, version, actor) => {
      await activate(context, id, version, actor);
      return summary(id);
    },
    deactivate: (id, actor) => {
      deactivate(context, id, actor);
      return summary(id);
    },
    mute: (id, until, principal) => {
      mute(context, id, until, principal);
      return summary(id);
    },
    unmute: (id, actor) => {
      unmute(context, id, actor);
      return summary(id);
    },
  };
}
