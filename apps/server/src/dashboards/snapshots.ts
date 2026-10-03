/**
 * Snapshots: a version frozen with the results its panels showed, at a link that opens with no
 * query and no model. Taking one runs every panel here, through the same path as the dashboard,
 * so the browser never sends results. The taker is recorded for the audit trail only.
 */
import {
  type DashboardSpec,
  type PanelRun,
  type Role,
  resolveTimeRange,
  type Snapshot,
  type SnapshotLifetime,
  type SnapshotSummary,
  snapshotSchema,
  type VariableValues,
} from '@quanthea/shared';
import type {
  SnapshotRepository,
  SnapshotRow,
  SnapshotSummaryRow,
} from '../db/snapshot-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newSnapshotId } from '../lib/ids.ts';
import {
  type DashboardsDependencies,
  type RunTarget,
  type ServiceContext,
  specOf,
} from './context.ts';
import { runPanel } from './run-panel.ts';

/**
 * The most bytes of spec and results one snapshot stores by default: 10 MiB. A query returns at
 * most 50,000 rows by default, a few MB as JSON, so a usual dashboard fits with room to spare.
 */
const defaultMaxBytes = 10 * 1024 * 1024;

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/** How long each lifetime lasts, in milliseconds; `null` lives until revoked. */
const lifetimeMs: Readonly<Record<SnapshotLifetime, number | null>> = {
  '1d': dayMs,
  '7d': 7 * dayMs,
  '30d': 30 * dayMs,
  forever: null,
};

/** What a snapshot freezes: a version as the dashboard shows it, and how long it lives. */
export interface SnapshotRequest extends RunTarget {
  /** The sets of markers hidden on the dashboard. */
  readonly hiddenMarkers: readonly string[];
  /** How long it lives. */
  readonly lifetime: SnapshotLifetime;
}

/** A snapshot without its data, naming its taker by user id. */
export type SnapshotInfo = Omit<SnapshotSummary, 'takenBy'> & {
  /** The user id of whoever took it. */
  readonly takerId: string;
};

/** A snapshot with its spec and runs, naming its taker by user id. */
export type FrozenSnapshot = SnapshotInfo & Pick<Snapshot, 'spec' | 'panels'>;

/** The snapshots service. */
export interface Snapshots {
  /**
   * Takes a snapshot: resolves the time range to absolute times and runs every panel with the
   * variables, as the dashboard does.
   *
   * @param request - The version, the choices, the hidden markers and the lifetime.
   * @param role - The role the version is read with.
   * @param actor - Who takes it.
   * @param signal - Aborted when the caller gives up.
   * @returns The snapshot.
   * @throws {AppError} `not_found` for a version the role may not see, `bad_request` for invalid
   *   choices or a snapshot over the size cap.
   */
  take(
    request: SnapshotRequest,
    role: Role,
    actor: string,
    signal?: AbortSignal,
  ): Promise<SnapshotInfo>;
  /**
   * Opens a live snapshot. It runs no query.
   *
   * @param id - The snapshot.
   * @returns The snapshot with its data.
   * @throws {AppError} `not_found` for an unknown, revoked or expired one alike.
   */
  open(id: string): FrozenSnapshot;
  /**
   * Lists the live snapshots, the newest first.
   *
   * @param dashboardId - Only this dashboard's, when given.
   * @returns The snapshots.
   */
  list(dashboardId?: string): SnapshotInfo[];
  /**
   * Revokes a live snapshot: its link stops working at once.
   *
   * @param id - The snapshot.
   * @param actor - Who revokes it.
   * @throws {AppError} `not_found` for an unknown, revoked or expired one alike.
   */
  revoke(id: string, actor: string): void;
  /**
   * Deletes the snapshots whose time is up.
   *
   * @returns How many it deleted.
   */
  purgeExpired(): number;
}

/** What the snapshots service needs: the dashboards' dependencies and the snapshots' store. */
export interface SnapshotsDependencies extends DashboardsDependencies {
  /** Stores snapshots. */
  readonly snapshots: SnapshotRepository;
  /** The most bytes of spec and results one snapshot stores; 10 MiB by default. */
  readonly maxBytes?: number;
}

/** The service's dependencies with the clock resolved. */
type SnapshotContext = ServiceContext &
  Pick<SnapshotsDependencies, 'snapshots'> & { readonly maxBytes: number };

/** Turns text into bytes, to measure it. */
const encoder = new TextEncoder();

/**
 * The same "not found" for an unknown, revoked or expired snapshot.
 *
 * @returns The error.
 */
function notFound(): AppError {
  return new AppError('not_found', 'No such snapshot. It may have expired or been revoked.');
}

/**
 * The variable values a version shows: the chosen ones, else the defaults, for the declared
 * variables only. Snapshots and questions record these.
 *
 * @param spec - The spec.
 * @param picked - The choices.
 * @returns The values.
 */
export function shownVariables(spec: DashboardSpec, picked: VariableValues): VariableValues {
  const entries = spec.variables.flatMap((variable) => {
    const value = picked[variable.name] ?? variable.default;
    return value === undefined ? [] : [[variable.name, value] as const];
  });
  return Object.fromEntries(entries);
}

/**
 * Runs every panel over one absolute range, so they all show the same moment.
 *
 * @param context - The service context.
 * @param spec - The spec.
 * @param request - The choices.
 * @param signal - Aborted when the caller gives up.
 * @returns The range and each panel's run by panel id.
 */
async function runAll(
  context: SnapshotContext,
  spec: DashboardSpec,
  request: SnapshotRequest,
  signal?: AbortSignal,
) {
  const range = resolveTimeRange(request.time ?? spec.time, context.now());
  const time = { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() };
  const choices = { variables: request.variables, time };
  const runs = await Promise.all(
    spec.panels.map(
      async (panel) =>
        [panel.id, await runPanel(context, spec, panel.id, choices, signal)] as const,
    ),
  );
  return { range, panels: Object.fromEntries(runs) as Record<string, PanelRun> };
}

/**
 * Measures the stored data and refuses a snapshot over the cap.
 *
 * @param json - The spec and the runs, as JSON.
 * @param maxBytes - The cap.
 * @returns The size in bytes.
 * @throws {AppError} `bad_request` over the cap.
 */
function checkedSize(json: readonly string[], maxBytes: number): number {
  const bytes = json.reduce((sum, text) => sum + encoder.encode(text).byteLength, 0);
  if (bytes <= maxBytes) return bytes;
  const megabytes = (count: number) => (count / 1_048_576).toFixed(1);
  throw new AppError(
    'bad_request',
    `This snapshot would hold ${megabytes(bytes)} MB of results; a snapshot holds at most ` +
      `${megabytes(maxBytes)} MB. Narrow the time range or the variables, then take it again.`,
  );
}

/**
 * A stored summary as the service gives it.
 *
 * @param row - The stored summary.
 * @returns The snapshot without its data.
 */
function infoOf(row: SnapshotSummaryRow): SnapshotInfo {
  const parsed = snapshotSchema.pick({ variables: true, hiddenMarkers: true }).parse(row);
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    version: row.version,
    title: row.title,
    time: { from: row.timeFrom, to: row.timeTo },
    ...parsed,
    takerId: row.takenBy,
    takenAt: row.takenAt,
    expiresAt: row.expiresAt,
    bytes: row.bytes,
  };
}

/**
 * Takes a snapshot.
 *
 * @param context - The service context.
 * @param request - The version, the choices, the hidden markers and the lifetime.
 * @param role - The role the version is read with.
 * @param actor - Who takes it.
 * @param signal - Aborted when the caller gives up.
 * @returns The snapshot.
 */
async function take(
  context: SnapshotContext,
  request: SnapshotRequest,
  role: Role,
  actor: string,
  signal?: AbortSignal,
): Promise<SnapshotInfo> {
  const spec = specOf(context, request, role);
  const { range, panels } = await runAll(context, spec, request, signal);
  const json = { spec: JSON.stringify(spec), panels: JSON.stringify(panels) };
  const takenAt = context.now();
  const lifetime = lifetimeMs[request.lifetime];
  const known = new Set(spec.annotations.map((annotation) => annotation.id));
  const row = {
    id: newSnapshotId(),
    dashboardId: request.dashboardId,
    version: request.version,
    title: spec.title,
    timeFrom: range.from,
    timeTo: range.to,
    variables: shownVariables(spec, request.variables),
    hiddenMarkers: [...new Set(request.hiddenMarkers)].filter((id) => known.has(id)),
    ...json,
    bytes: checkedSize([json.spec, json.panels], context.maxBytes),
    takenBy: actor,
    takenAt,
    expiresAt: lifetime === null ? null : takenAt + lifetime,
  };
  context.snapshots.insert(row);
  const detail = { dashboardId: row.dashboardId, version: row.version, lifetime: request.lifetime };
  context.audit.append({ actor, action: 'snapshot.take', target: row.id, detail });
  return infoOf(row);
}

/**
 * Turns a stored snapshot into the service's.
 *
 * @param row - The stored snapshot.
 * @returns The snapshot with its spec and runs.
 */
function frozenOf(row: SnapshotRow): FrozenSnapshot {
  const { spec, panels } = snapshotSchema.pick({ spec: true, panels: true }).parse(row);
  return { ...infoOf(row), spec, panels };
}

/**
 * Creates the service.
 *
 * @param dependencies - The dashboards' dependencies and the snapshots' store.
 * @returns The service.
 */
export function createSnapshots(dependencies: SnapshotsDependencies): Snapshots {
  const context: SnapshotContext = {
    ...dependencies,
    now: dependencies.now ?? Date.now,
    maxBytes: dependencies.maxBytes ?? defaultMaxBytes,
  };
  const { snapshots, audit } = context;
  return {
    take: (request, role, actor, signal) => take(context, request, role, actor, signal),
    open: (id) => {
      const row = snapshots.get(id, context.now());
      if (!row) throw notFound();
      return frozenOf(row);
    },
    list: (dashboardId) => snapshots.list(context.now(), dashboardId).map(infoOf),
    revoke: (id, actor) => {
      const dashboardId = snapshots.remove(id, context.now());
      if (dashboardId === undefined) throw notFound();
      audit.append({ actor, action: 'snapshot.revoke', target: id, detail: { dashboardId } });
    },
    purgeExpired: () => snapshots.removeExpired(context.now()),
  };
}
