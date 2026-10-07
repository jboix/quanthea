/**
 * The changes people make to alerts: save a version, activate one, mute and unmute.
 * Versions are never rewritten. Activating checks the spec again and runs its query once, and
 * holds to the cap of active alerts per connector.
 */
import {
  type AlertSeed,
  type AlertSettings,
  type AlertSpec,
  alertSpecChanges,
  alertSpecSchema,
  hasRole,
  type Principal,
  type SpecChange,
} from '@quanthea/shared';
import type { ConnectorLookup } from '../dashboards/check-queries.ts';
import { refuseSpec } from '../dashboards/context.ts';
import type { AlertActivityRepository } from '../db/alert-activity.ts';
import type { AlertLinkRepository } from '../db/alert-link-repository.ts';
import type { AlertRepository, AlertRow } from '../db/alert-repository.ts';
import type { AlertStateRepository } from '../db/alert-state-repository.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { checkAlert } from './check.ts';
import type { Notify } from './evaluate.ts';
import type { AlertQueryDependencies } from './run-query.ts';
import { validateAlertSpec } from './validate.ts';

/** What the alert service needs. */
export interface AlertsDependencies extends AlertQueryDependencies {
  /** Stores alerts and their versions. */
  readonly repository: AlertRepository;
  /** Stores the state of their series. */
  readonly states: AlertStateRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** Reads the channels, the sends and the audited changes of alerts; none when left out. */
  readonly activity?: AlertActivityRepository | undefined;
  /** Finds a connector by name, for validation. */
  readonly lookup: ConnectorLookup;
  /** The alert settings. */
  readonly settings: { readonly get: () => AlertSettings };
  /** Whether a notification channel exists, checked on save and activation. */
  readonly channelExists?: ((channelId: string) => boolean) | undefined;
  /** Sends notifications: the resolved ones when an alert is deactivated. */
  readonly notify: Notify;
  /** The link to an alert. */
  readonly alertUrl: (alertId: string) => string;
  /** Stores the links to panels: an alert made from a panel links to it. None when left out. */
  readonly links?: Pick<AlertLinkRepository, 'add'> | undefined;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The service's dependencies with the clock resolved. */
export type AlertsContext = AlertsDependencies & { readonly now: () => number };

/** A new version to save. */
export interface NewVersion {
  /** The alert; a new alert when left out. */
  readonly alertId?: string | undefined;
  /** The spec, as JSON. */
  readonly spec: unknown;
  /** What changed, in words. */
  readonly note?: string | null | undefined;
  /** The conversation that made it, for a new alert. */
  readonly threadId?: string | null | undefined;
  /** The panel that conversation started from: a new alert links to it. */
  readonly seed?: AlertSeed | null | undefined;
}

/** A change made by hand to an active alert. */
export interface ActiveChange {
  /** The active version it starts from. */
  readonly basedOn: number;
  /** The whole spec with the change, as JSON. */
  readonly spec: unknown;
  /** What changed, in words; the changed fields when left out. */
  readonly note?: string | undefined;
}

/** The longest an analyst may mute an alert: seven days. */
export const maxAnalystMuteMs = 7 * 86_400_000;

/**
 * Reads an alert.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @returns The alert.
 * @throws {AppError} `not_found`.
 */
export function alertOrThrow(context: AlertsContext, id: string): AlertRow {
  const alert = context.repository.get(id);
  if (!alert) throw new AppError('not_found', `No alert ${id}.`);
  return alert;
}

/**
 * Saves a new version from a spec. The spec is validated; its query is not run.
 *
 * @param context - The service context.
 * @param input - The alert, the spec, a note and the thread.
 * @param actor - Who saves.
 * @returns The alert and the version number.
 * @throws {AppError} `bad_request` with the spec's issues, `not_found` for an unknown alert.
 */
export function saveVersion(
  context: AlertsContext,
  input: NewVersion,
  actor: string,
): { alertId: string; version: number } {
  if (input.alertId !== undefined) alertOrThrow(context, input.alertId);
  const now = context.now();
  const { lookup, channelExists } = context;
  const validation = validateAlertSpec(input.spec, { lookup, channelExists, now });
  if (!validation.ok) refuseSpec('The alert spec is invalid.', validation.issues);
  const alertId = input.alertId ?? newId();
  const { spec } = validation;
  const row = { alertId, title: spec.title, spec, note: input.note ?? null, createdBy: actor };
  const version = context.repository.addVersion({ ...row, createdAt: now }, input.threadId);
  context.audit.append({ actor, action: 'alert.version', target: alertId, detail: { version } });
  if (input.alertId === undefined && input.seed) linkSeed(context, alertId, input.seed, actor);
  return { alertId, version };
}

/**
 * Links a new alert to the panel its conversation started from. A dashboard deleted since leaves
 * no link.
 *
 * @param context - The service context.
 * @param alertId - The new alert.
 * @param seed - The panel.
 * @param actor - Who saved the alert.
 */
function linkSeed(context: AlertsContext, alertId: string, seed: AlertSeed, actor: string): void {
  const { dashboardId, panelId } = seed;
  const link = { alertId, dashboardId, panelId, createdBy: actor, createdAt: context.now() };
  try {
    context.links?.add({ ...link, how: 'from_panel' });
  } catch {
    // The dashboard is gone: its foreign key refuses the link.
  }
}

/**
 * Refuses an activation that would pass the cap of active alerts on the spec's connector.
 *
 * @param context - The service context.
 * @param alertId - The alert being activated.
 * @param spec - Its spec.
 * @throws {AppError} `conflict` at the cap.
 */
function checkCap(context: AlertsContext, alertId: string, spec: AlertSpec): void {
  const { maxActivePerConnector } = context.settings.get();
  const connector = spec.query.connector;
  const active = context.repository
    .evaluated()
    .filter((each) => each.alert.id !== alertId)
    .filter((each) => (each.spec as AlertSpec).query?.connector === connector);
  if (active.length >= maxActivePerConnector)
    throw new AppError(
      'conflict',
      `"${connector}" already has ${active.length} active alerts, the most allowed.`,
    );
}

/**
 * Refuses an activation while the thread that made the alert is in the bin: purging it would
 * leave an active alert without its thread.
 *
 * @param binned - Whether the thread is in the bin.
 * @throws {AppError} `bad_request` when it is.
 */
function checkOutsideBin(binned: boolean): void {
  if (binned)
    throw new AppError('bad_request', 'Its thread is in the bin. Restore it before activating.');
}

/**
 * Activates a version: checks it again, runs its query once, and holds to the cap.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param version - The version.
 * @param actor - Who activates.
 * @throws {AppError} `not_found`, `bad_request` with the issues or while its thread is in the bin,
 *   or `conflict` at the cap.
 */
export async function activate(
  context: AlertsContext,
  id: string,
  version: number,
  actor: string,
): Promise<void> {
  alertOrThrow(context, id);
  checkOutsideBin(context.repository.threadBinned(id));
  const row = context.repository.version(id, version);
  if (!row) throw new AppError('not_found', `Alert ${id} has no version ${version}.`);
  const check = await checkAlert(context, row.spec, context.now());
  if (!check.ok) refuseSpec('This version cannot be activated.', check.issues);
  checkCap(context, id, check.spec);
  // The thread may have gone to the bin while the query ran.
  checkOutsideBin(context.repository.activate(id, version, context.now()) === 'binned');
  context.audit.append({ actor, action: 'alert.activate', target: id, detail: { version } });
}

/**
 * Saves changes to an alert's active version as a new version and activates it. The changed spec
 * is checked and its query run once before anything is saved, so a refusal leaves no version.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param change - The active version it starts from, the changed spec and a note.
 * @param actor - Who changes it.
 * @returns The new version and the fields that changed.
 * @throws {AppError} `conflict` when another version is active now, `bad_request` when nothing
 *   changed, the spec is invalid or its thread is in the bin, `not_found`.
 */
export async function activateChange(
  context: AlertsContext,
  id: string,
  change: ActiveChange,
  actor: string,
): Promise<{ version: number; changes: SpecChange[] }> {
  const active = activeVersionOf(context, id, change.basedOn);
  checkOutsideBin(context.repository.threadBinned(id));
  const parsed = alertSpecSchema.safeParse(change.spec);
  const changes = alertSpecChanges(active, parsed.success ? parsed.data : change.spec);
  if (changes.length === 0) throw new AppError('bad_request', 'Nothing changed.');
  const check = await checkAlert(context, change.spec, context.now());
  if (!check.ok) refuseSpec('The changed alert is invalid.', check.issues);
  const note = change.note ?? handEditNote(changes);
  const { version } = saveVersion(context, { alertId: id, spec: change.spec, note }, actor);
  await activate(context, id, version, actor);
  return { version, changes };
}

/**
 * The spec of an alert's active version, which must be the one a change starts from.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param basedOn - The version the change starts from.
 * @returns The active version's spec.
 * @throws {AppError} `conflict` when it is not the active version, `not_found`.
 */
function activeVersionOf(context: AlertsContext, id: string, basedOn: number): unknown {
  const alert = alertOrThrow(context, id);
  const row = context.repository.version(id, basedOn);
  if (alert.activeVersion !== basedOn || !row)
    throw new AppError(
      'conflict',
      `v${basedOn} is no longer the active version. Reload the alert.`,
    );
  return row.spec;
}

/**
 * The note of a change made by hand: the fields it changed.
 *
 * @param changes - The changes.
 * @returns Such as `By hand: condition.value, condition.for`.
 */
export function handEditNote(changes: readonly SpecChange[]): string {
  return `By hand: ${changes.map((change) => change.path).join(', ')}`.slice(0, 200);
}

/**
 * Checks a mute's end against the role: analysts mute up to seven days ahead, editors also
 * without an end.
 *
 * @param until - The end, or `null` for none.
 * @param role - The role of whoever mutes.
 * @param now - The current instant.
 * @throws {AppError} `bad_request` for an end in the past or too far for an analyst, `forbidden`
 *   for no end below editor.
 */
function checkMuteEnd(until: number | null, role: Principal['role'], now: number): void {
  const editor = hasRole(role, 'editor');
  if (until === null) {
    if (!editor) throw new AppError('forbidden', 'Muting without an end needs the editor role.');
    return;
  }
  if (until <= now) throw new AppError('bad_request', 'Choose an end in the future.');
  if (!editor && until - now > maxAnalystMuteMs)
    throw new AppError('bad_request', 'Mute for at most 7 days.');
}

/**
 * Mutes an alert's notifications. Evaluation and state go on.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param until - The end, or `null` until someone unmutes.
 * @param principal - Who mutes.
 * @throws {AppError} `not_found`, `bad_request` or `forbidden` for an end the role may not set.
 */
export function mute(
  context: AlertsContext,
  id: string,
  until: number | null,
  principal: Principal,
): void {
  alertOrThrow(context, id);
  const now = context.now();
  checkMuteEnd(until, principal.role, now);
  context.repository.setMute(id, { at: now, by: principal.id, until }, now);
  const actor = principal.id;
  context.audit.append({ actor, action: 'alert.mute', target: id, detail: { until } });
}

/**
 * Unmutes an alert.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param actor - Who unmutes.
 * @throws {AppError} `not_found`.
 */
export function unmute(context: AlertsContext, id: string, actor: string): void {
  alertOrThrow(context, id);
  context.repository.setMute(id, null, context.now());
  context.audit.append({ actor, action: 'alert.unmute', target: id });
}
