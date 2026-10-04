/**
 * Questions about a report's run: a shared record of the run, as questions about a pinned
 * dashboard are of the dashboard. A run is read as the asker's role reads it, and only a run that
 * succeeded has results to ask about. The question is stored with its outcome once the answer ends;
 * the asker is recorded for accountability only. The answering happens elsewhere, so `reports/`
 * never runs a model.
 */
import {
  type DashboardSource,
  dashboardOfReport,
  type ReportRunDetail,
  type Role,
} from '@quanthea/shared';
import type { ConversationInfo } from '../dashboards/question-info.ts';
import { sourcesOf } from '../dashboards/question-sources.ts';
import { type AnsweredOutcome, usageTokens } from '../dashboards/questions.ts';
import type { ReportConversationBinRepository } from '../db/report-conversation-bin.ts';
import type {
  ReportQuestionRepository,
  ReportQuestionRow,
} from '../db/report-question-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { meaningfulWords } from '../lib/words.ts';
import { listRunConversations, runQuestionsOf } from './conversations.ts';
import { type RunQuestionInfo, runQuestionInfo } from './question-info.ts';
import type { Reports } from './reports.ts';

/** The most earlier questions a search offers. */
const maxSimilar = 3;

/** The most earlier questions and answers a follow-up carries. */
const maxHistory = 10;

/** A run, by its report. */
export interface RunTarget {
  /** The report. */
  readonly reportId: string;
  /** The run. */
  readonly runId: string;
}

/** A question about a run as it is asked. */
export interface RunQuestionRequest extends RunTarget {
  /** The question. */
  readonly question: string;
  /** The conversation it continues, following up on its latest question. */
  readonly conversationId?: string | undefined;
}

/** A question ready to answer: everything the answer and the stored record need. */
export interface PreparedRunQuestion extends RunTarget {
  /** The id it will be stored with. */
  readonly id: string;
  /** The run, with its frozen results. */
  readonly run: ReportRunDetail;
  /** The time zone the answer names times in: the schedule's. */
  readonly timeZone: string;
  /** Whether no source of the run shows numbers. */
  readonly explainOnly: boolean;
  /** The question. */
  readonly question: string;
  /** The question it follows up on. */
  readonly parentId: string | null;
  /** The conversation's first question: its own id when it starts one. */
  readonly rootId: string;
  /** The earlier questions and answers of its chain, oldest first. */
  readonly history: readonly { readonly question: string; readonly answer: string }[];
  /** Who asks, by user id. */
  readonly askedBy: string;
  /** When. */
  readonly askedAt: number;
}

/** What the questions about runs need. */
export interface RunQuestionsDependencies {
  /** The reports, to read a run as a role reads it. */
  readonly reports: Pick<Reports, 'run'>;
  /** Stores the questions. */
  readonly questions: ReportQuestionRepository;
  /** The bin of conversations about runs, so a binned one is not continued. */
  readonly binned: Pick<ReportConversationBinRepository, 'get'>;
  /** The configured connectors' names and access levels. */
  readonly connectorLevels: () => readonly { name: string; accessLevel: number }[];
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The service's context. */
export type RunQuestionContext = RunQuestionsDependencies & { readonly now: () => number };

/** The questions about runs. */
export interface RunQuestions {
  /**
   * Prepares a question about a run: reads the run as the role reads it and gathers the chain it
   * follows up on, the conversation's latest question.
   *
   * @param request - The run, the question and the conversation it continues.
   * @param actor - Who asks.
   * @param role - Their role.
   * @returns The prepared question.
   * @throws {AppError} `not_found` for a run the role may not see or an unknown conversation,
   *   `bad_request` for a run without results, `conflict` for a conversation in the bin.
   */
  prepare(request: RunQuestionRequest, actor: string, role: Role): PreparedRunQuestion;
  /**
   * Stores a question with its outcome.
   *
   * @param prepared - The question.
   * @param outcome - How its answer ended.
   */
  record(prepared: PreparedRunQuestion, outcome: AnsweredOutcome): void;
  /**
   * Lists a run's conversations, the latest activity first, or those a search finds.
   *
   * @param target - The run.
   * @param text - The search, empty for all.
   * @param role - The role the run is read with.
   * @returns The conversations.
   */
  conversations(target: RunTarget, text: string, role: Role): ConversationInfo[];
  /**
   * Reads one conversation's questions, in the order they were asked.
   *
   * @param target - The run.
   * @param conversationId - The conversation's first question.
   * @param role - The role the run is read with.
   * @returns The questions.
   */
  conversation(target: RunTarget, conversationId: string, role: Role): RunQuestionInfo[];
  /**
   * Finds earlier answered questions about the run sharing words with a text.
   *
   * @param target - The run.
   * @param text - The text being typed.
   * @param role - The role the run is read with.
   * @returns At most three, the best first.
   */
  similar(target: RunTarget, text: string, role: Role): RunQuestionInfo[];
  /**
   * The sources a run's version reads, by name and access level.
   *
   * @param target - The run.
   * @param role - The role the run is read with.
   * @returns One per connector the spec names.
   */
  sources(target: RunTarget, role: Role): DashboardSource[];
}

/**
 * The earlier questions and answers of a chain, oldest first: the answered ones, at most
 * {@link maxHistory}.
 *
 * @param context - The service context.
 * @param parent - The question followed up on.
 * @returns The history.
 */
function historyOf(context: RunQuestionContext, parent: ReportQuestionRow) {
  const chain: { question: string; answer: string }[] = [];
  for (let row: ReportQuestionRow | undefined = parent; row && chain.length < maxHistory; ) {
    if (row.answer !== null) chain.unshift({ question: row.question, answer: row.answer });
    row = row.parentId === null ? undefined : context.questions.get(row.parentId);
  }
  return chain;
}

/**
 * The sources of a run's version with their access levels.
 *
 * @param context - The service context.
 * @param run - The run.
 * @returns The sources.
 */
function runSources(context: RunQuestionContext, run: ReportRunDetail): DashboardSource[] {
  return sourcesOf(context.connectorLevels, dashboardOfReport(run.spec, run.period));
}

/**
 * Prepares a question.
 *
 * @param context - The service context.
 * @param request - The run, the question and the conversation.
 * @param actor - Who asks.
 * @param role - Their role.
 * @returns The prepared question.
 */
function prepare(
  context: RunQuestionContext,
  request: RunQuestionRequest,
  actor: string,
  role: Role,
): PreparedRunQuestion {
  const run = context.reports.run(request.reportId, request.runId, role);
  if (run.status !== 'ok' || run.panels === null)
    throw new AppError('bad_request', 'This run has no results to ask about.');
  const { conversationId } = request;
  const parent =
    conversationId === undefined
      ? undefined
      : runQuestionsOf(context, request.runId, conversationId).at(-1);
  const id = newId();
  return {
    id,
    reportId: request.reportId,
    runId: request.runId,
    run,
    timeZone: run.spec.schedule.timezone,
    explainOnly: !runSources(context, run).some(({ accessLevel }) => (accessLevel ?? 0) >= 3),
    question: request.question,
    parentId: parent?.id ?? null,
    rootId: parent?.rootId ?? id,
    history: parent ? historyOf(context, parent) : [],
    askedBy: actor,
    askedAt: context.now(),
  };
}

/**
 * The row of a question and its outcome.
 *
 * @param prepared - The question.
 * @param outcome - How its answer ended.
 * @returns The row.
 */
function rowOf(prepared: PreparedRunQuestion, outcome: AnsweredOutcome): ReportQuestionRow {
  const { reportId, runId, id, parentId, rootId, timeZone, explainOnly } = prepared;
  return {
    ...{ id, reportId, runId, parentId, rootId, timeZone, explainOnly },
    askedBy: prepared.askedBy,
    askedAt: prepared.askedAt,
    question: prepared.question,
    answer: outcome.ok ? outcome.answer.text : null,
    failure: outcome.ok ? null : outcome.message,
    citations: outcome.ok ? outcome.answer.citations : [],
    evidence: outcome.ok ? outcome.answer.evidence : outcome.evidence,
    followUps: outcome.ok ? (outcome.answer.followUps ?? []) : [],
    usage: outcome.usage,
    tokens: usageTokens(outcome.usage),
  };
}

/**
 * Finds earlier answered questions sharing words with a text.
 *
 * @param context - The service context.
 * @param target - The run.
 * @param text - The text.
 * @param role - The role the run is read with.
 * @returns The questions, the best first.
 */
function similar(context: RunQuestionContext, target: RunTarget, text: string, role: Role) {
  context.reports.run(target.reportId, target.runId, role);
  const words = [...meaningfulWords(text)];
  return context.questions.search(target.runId, words, maxSimilar).flatMap(({ id }) => {
    const row = context.questions.get(id);
    return row ? [runQuestionInfo(row)] : [];
  });
}

/**
 * Creates the questions about runs.
 *
 * @param dependencies - The reports, the questions' store, the bin and the connectors' levels.
 * @returns The service.
 */
export function createRunQuestions(dependencies: RunQuestionsDependencies): RunQuestions {
  const context: RunQuestionContext = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    prepare: (request, actor, role) => prepare(context, request, actor, role),
    record: (prepared, outcome) => context.questions.insert(rowOf(prepared, outcome)),
    conversations: (target, text, role) => {
      context.reports.run(target.reportId, target.runId, role);
      return listRunConversations(context, target.runId, text);
    },
    conversation: (target, conversationId, role) => {
      context.reports.run(target.reportId, target.runId, role);
      return runQuestionsOf(context, target.runId, conversationId).map(runQuestionInfo);
    },
    similar: (target, text, role) => similar(context, target, text, role),
    sources: (target, role) =>
      runSources(context, context.reports.run(target.reportId, target.runId, role)),
  };
}
