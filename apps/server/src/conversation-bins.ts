/**
 * The bin's conversations, about dashboards and about reports' runs, as one: the bin lists them
 * together, the most recently binned first, and restores, deletes and purges either kind by its id.
 * Each kind keeps its own store and rules; ids are ULIDs, so one id names one conversation.
 */
import type { BinActor, ConversationBin } from './dashboards/conversation-bin.ts';
import type { RunConversationBin } from './reports/conversation-bin.ts';

/** A binned conversation as the bin lists it, naming people by user id. */
export interface BinnedConversationView {
  /** The conversation: its first question's id. */
  readonly id: string;
  /** The dashboard it is about; `null` for a run. */
  readonly dashboardId: string | null;
  /** The dashboard's title, or the report's. */
  readonly dashboardTitle: string;
  /** The run it is about, with its period; `null` for a dashboard. */
  readonly run: {
    readonly reportId: string;
    readonly runId: string;
    readonly period: string;
  } | null;
  /** Its first question. */
  readonly question: string;
  /** Who started it, by user id. */
  readonly startedBy: string;
  /** When. */
  readonly startedAt: number;
  /** How many questions it holds. */
  readonly count: number;
  /** When it went to the bin. */
  readonly binnedAt: number;
  /** Who moved it there, by user id. */
  readonly binnedBy: string;
}

/** Both bins of conversations. */
export interface ConversationBins {
  /** Moves a conversation about a dashboard to the bin. */
  readonly bin: ConversationBin['bin'];
  /** Moves a conversation about a run to the bin. */
  readonly binRun: RunConversationBin['bin'];
  /**
   * Lists the binned conversations someone may restore, both kinds, the most recently binned
   * first.
   *
   * @param actor - Who asks.
   * @returns The conversations.
   */
  list(actor: BinActor): BinnedConversationView[];
  /**
   * Takes a conversation of either kind out of the bin.
   *
   * @param conversationId - The conversation.
   * @param actor - Who restores it.
   * @throws {AppError} `not_found` when it is in neither bin, or not the actor's to restore.
   */
  restore(conversationId: string, actor: BinActor): void;
  /**
   * Deletes a binned conversation of either kind for good.
   *
   * @param conversationId - The conversation.
   * @param actor - Who deletes it.
   * @throws {AppError} `not_found` when it is in neither bin.
   */
  purge(conversationId: string, actor: string): void;
  /**
   * Deletes the conversations of both kinds binned before a time, or all of them.
   *
   * @param actor - Who deletes them.
   * @param before - Only those binned before this time; all without it.
   * @returns How many were deleted.
   */
  purgeAll(actor: string, before?: number): number;
}

/**
 * Lists both kinds of binned conversations together.
 *
 * @param dashboards - The bin of conversations about dashboards.
 * @param runs - The bin of conversations about runs.
 * @param actor - Who asks.
 * @returns The conversations, the most recently binned first.
 */
function listBoth(
  dashboards: ConversationBin,
  runs: RunConversationBin,
  actor: BinActor,
): BinnedConversationView[] {
  const aboutDashboards = dashboards.list(actor).map((row) => ({ ...row, run: null }));
  const aboutRuns = runs.list(actor).map(({ reportId, runId, period, reportTitle, ...row }) => ({
    ...row,
    dashboardId: null,
    dashboardTitle: reportTitle,
    run: { reportId, runId, period },
  }));
  return [...aboutDashboards, ...aboutRuns].sort(
    (one, other) => other.binnedAt - one.binnedAt || other.id.localeCompare(one.id),
  );
}

/**
 * Joins the two bins of conversations.
 *
 * @param dashboards - The bin of conversations about dashboards.
 * @param runs - The bin of conversations about runs.
 * @returns Both bins as one.
 */
export function combineConversationBins(
  dashboards: ConversationBin,
  runs: RunConversationBin,
): ConversationBins {
  return {
    bin: dashboards.bin,
    binRun: runs.bin,
    list: (actor) => listBoth(dashboards, runs, actor),
    restore: (conversationId, actor) => {
      if (!runs.restore(conversationId, actor)) dashboards.restore(conversationId, actor);
    },
    purge: (conversationId, actor) => {
      if (!runs.purge(conversationId, actor)) dashboards.purge(conversationId, actor);
    },
    purgeAll: (actor, before) => dashboards.purgeAll(actor, before) + runs.purgeAll(actor, before),
  };
}
