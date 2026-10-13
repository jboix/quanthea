/**
 * Explanations of the panels of a pinned version, kept per version and panel. An explanation is
 * written from the spec and the schema alone, so it is shown to every role, and a version's spec
 * never changes, so it stays valid. Asking again adds one; the latest is shown. A panel with none
 * on the version shown takes the one of an earlier version, by panel id, and says whether the
 * panel changed since. Only one explanation of a panel is written at a time, so none is paid for
 * twice. The writing itself happens elsewhere, so `dashboards/` never runs a model.
 */
import {
  type DashboardSpec,
  dashboardSpecSchema,
  type PanelExplanation,
  type Role,
} from '@quanthea/shared';
import type {
  ExplanationRepository,
  ExplanationRow,
  PanelKey,
} from '../db/explanation-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { type DashboardsDependencies, type ServiceContext, shownSpecOf } from './context.ts';
import { type AnsweredOutcome, usageTokens } from './questions.ts';

/** How long a claim to write an explanation holds, in case its writing never reports back. */
const claimMs = 10 * 60_000;

/** An explanation about to be written: everything the request and the stored row need. */
export interface PreparedExplanation extends PanelKey {
  /** The id it will be stored with. */
  readonly id: string;
  /** The version's spec. */
  readonly spec: DashboardSpec;
  /** Who asks for it, by user id. */
  readonly explainedBy: string;
  /** When. */
  readonly explainedAt: number;
}

/** A stored explanation, naming who asked for it by user id. */
export type ExplanationInfo = Omit<PanelExplanation, 'explainedBy'> & {
  /** The user id of whoever asked for it. */
  readonly explainerId: string;
};

/** The explanation a panel of a version shows, and whether one is being written. */
export interface LatestExplanation {
  /** The latest explanation of the version or, with none, of an earlier one; or `null`. */
  readonly explanation: ExplanationInfo | null;
  /** Whether one is being written now. */
  readonly generating: boolean;
  /** Whether the panel's queries or view differ from those of the version explained. */
  readonly panelChanged: boolean;
}

/** The explanations service. */
export interface Explanations {
  /**
   * Reads the explanation a panel of a version shows: its own latest or, with none, the latest
   * of the nearest earlier version that explained a panel of the same id.
   *
   * @param key - The panel of a version.
   * @param role - The role the version is read with.
   * @returns The explanation, whether one is being written, and whether the panel changed since.
   * @throws {AppError} `not_found` for a version the role may not see, or an unknown panel.
   */
  latest(key: PanelKey, role: Role): LatestExplanation;
  /**
   * Claims the writing of a panel's explanation, as everyone sees it: on a pinned version.
   *
   * @param key - The panel of a version.
   * @param replaces - The explanation the person saw, of this version or an earlier one, `null`
   *   for none.
   * @param actor - Who asks.
   * @returns The explanation to write, for this version. Record or release it.
   * @throws {AppError} `not_found` as {@link Explanations.latest} does for a viewer, `conflict`
   *   when one is being written or the latest is not the one the person saw.
   */
  prepare(key: PanelKey, replaces: string | null, actor: string): PreparedExplanation;
  /**
   * Stores a good explanation, and releases the claim.
   *
   * @param prepared - The explanation.
   * @param outcome - How its writing ended.
   */
  record(prepared: PreparedExplanation, outcome: AnsweredOutcome): void;
  /**
   * Releases the claim of an explanation that will not be written.
   *
   * @param prepared - The explanation.
   */
  release(prepared: PreparedExplanation): void;
}

/** What the explanations service needs besides the dashboards' context. */
export interface ExplanationsDependencies {
  /** Stores explanations. */
  readonly explanations: ExplanationRepository;
}

/** The service's context: the store, and the panels whose explanation is being written. */
type ExplanationContext = ServiceContext &
  ExplanationsDependencies & {
    /** Each claim, by panel key: the explanation it writes, and when it was taken. */
    readonly claims: Map<string, { readonly id: string; readonly since: number }>;
  };

/**
 * The key of a panel of a version in the claims.
 *
 * @param key - The panel of a version.
 * @returns The key.
 */
function claimKey({ dashboardId, version, panelId }: PanelKey): string {
  return JSON.stringify([dashboardId, version, panelId]);
}

/**
 * The spec of a version the role may see, checked to have the panel.
 *
 * @param context - The service context.
 * @param key - The panel of a version.
 * @param role - The role the version is read with.
 * @returns The spec.
 * @throws {AppError} `not_found`.
 */
function specWithPanel(context: ExplanationContext, key: PanelKey, role: Role): DashboardSpec {
  const spec = shownSpecOf(context, { ...key, variables: {} }, role);
  if (!spec.panels.some((panel) => panel.id === key.panelId))
    throw new AppError('not_found', `No panel "${key.panelId}" in this version.`);
  return spec;
}

/**
 * Whether a panel's explanation is being written: a claim younger than {@link claimMs}.
 *
 * @param context - The service context.
 * @param key - The panel of a version.
 * @returns Whether it is.
 */
function claimed(context: ExplanationContext, key: PanelKey): boolean {
  const claim = context.claims.get(claimKey(key));
  return claim !== undefined && context.now() - claim.since < claimMs;
}

/**
 * A stored explanation as the service gives it.
 *
 * @param row - The stored explanation.
 * @returns The explanation, naming who asked for it by id.
 */
function infoOf(row: ExplanationRow): ExplanationInfo {
  const { explainedBy, usage: _usage, ...rest } = row;
  return { ...rest, explainerId: explainedBy };
}

/**
 * Whether a panel differs, in its queries or its view, from the panel of the same id in the
 * version an explanation was written for. Its title, description and place do not count.
 *
 * @param context - The service context.
 * @param spec - The spec of the version shown.
 * @param row - The explanation shown.
 * @returns Whether it changed; `true` when the version explained can no longer be compared.
 */
function changedSince(context: ExplanationContext, spec: DashboardSpec, row: ExplanationRow) {
  const explained = context.repository.getVersion(row.dashboardId, row.version);
  const parsed = dashboardSpecSchema.safeParse(explained?.spec);
  const before = parsed.data?.panels.find((panel) => panel.id === row.panelId);
  const now = spec.panels.find((panel) => panel.id === row.panelId);
  if (!before || !now) return true;
  return !Bun.deepEquals([before.queries, before.view], [now.queries, now.view]);
}

/**
 * Reads the explanation a panel of a version shows.
 *
 * @param context - The service context.
 * @param key - The panel of a version.
 * @param role - The role the version is read with.
 * @returns The explanation, whether one is being written, and whether the panel changed since.
 */
function latest(context: ExplanationContext, key: PanelKey, role: Role): LatestExplanation {
  const spec = specWithPanel(context, key, role);
  const row = context.explanations.latestUpTo(key);
  const generating = claimed(context, key);
  if (!row) return { explanation: null, generating, panelChanged: false };
  const panelChanged = row.version !== key.version && changedSince(context, spec, row);
  return { explanation: infoOf(row), generating, panelChanged };
}

/**
 * Claims the writing of an explanation.
 *
 * @param context - The service context.
 * @param key - The panel of a version.
 * @param replaces - The explanation the person saw.
 * @param actor - Who asks.
 * @returns The explanation to write.
 */
function prepare(
  context: ExplanationContext,
  key: PanelKey,
  replaces: string | null,
  actor: string,
): PreparedExplanation {
  // Explanations are of what everyone may see: a pinned version of a pinned dashboard.
  const spec = specWithPanel(context, key, 'viewer');
  if (claimed(context, key))
    throw new AppError('conflict', 'This panel is being explained right now. Try again shortly.');
  // The one the person saw may be an earlier version's: the new one is written for this version.
  if ((context.explanations.latestUpTo(key)?.id ?? null) !== replaces)
    throw new AppError('conflict', 'This panel was explained meanwhile. Read that explanation.');
  const claim = { id: newId(), since: context.now() };
  context.claims.set(claimKey(key), claim);
  return { ...key, id: claim.id, spec, explainedBy: actor, explainedAt: claim.since };
}

/**
 * Releases the claim of an explanation, unless a newer one took its place.
 *
 * @param context - The service context.
 * @param prepared - The explanation.
 */
function release(context: ExplanationContext, prepared: PreparedExplanation): void {
  const key = claimKey(prepared);
  if (context.claims.get(key)?.id === prepared.id) context.claims.delete(key);
}

/**
 * Stores a good explanation and releases its claim.
 *
 * @param context - The service context.
 * @param prepared - The explanation.
 * @param outcome - How its writing ended.
 */
function record(
  context: ExplanationContext,
  prepared: PreparedExplanation,
  outcome: AnsweredOutcome,
): void {
  release(context, prepared);
  if (!outcome.ok) return;
  const { spec: _spec, ...stored } = prepared;
  const tokens = usageTokens(outcome.usage);
  context.explanations.insert({
    ...stored,
    text: outcome.answer.text,
    usage: outcome.usage,
    tokens,
  });
}

/**
 * Creates the service.
 *
 * @param dependencies - The dashboards' context and the explanations' store.
 * @returns The service.
 */
export function createExplanations(
  dependencies: DashboardsDependencies & ExplanationsDependencies,
): Explanations {
  const now = dependencies.now ?? Date.now;
  const context: ExplanationContext = { ...dependencies, now, claims: new Map() };
  return {
    latest: (key, role) => latest(context, key, role),
    prepare: (key, replaces, actor) => prepare(context, key, replaces, actor),
    record: (prepared, outcome) => record(context, prepared, outcome),
    release: (prepared) => release(context, prepared),
  };
}
