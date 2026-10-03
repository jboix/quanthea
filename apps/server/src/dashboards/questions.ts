/**
 * Questions about a pinned dashboard: a shared record of the dashboard, not a thread. Asking
 * resolves the range and the variables as a panel run does, from what the dashboard shows, and
 * stores the question with its outcome once the answer ends. The asker is recorded for
 * accountability only. The answering itself happens elsewhere, so `dashboards/` never runs a model.
 */
import {
  type Answer,
  type AnswerEvidence,
  type DashboardQuestion,
  type DashboardSource,
  type DashboardSpec,
  dashboardQuestionSchema,
  type ResolvedTimeRange,
  type Role,
  resolveTimeRange,
  type TimeRangeExpression,
  type TurnUsage,
  type VariableValues,
} from '@quanthea/shared';
import type { QuestionRepository, QuestionRow } from '../db/question-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { meaningfulWords } from '../lib/words.ts';
import { type DashboardsDependencies, get, type ServiceContext, specOf } from './context.ts';
import { shownVariables } from './snapshots.ts';

/** The most questions a dashboard lists. */
const maxListed = 200;

/** The most earlier questions a search offers. */
const maxSimilar = 3;

/** The most earlier questions and answers a follow-up carries. */
const maxHistory = 10;

/** A question as the dashboard shows it when it is asked. */
export interface QuestionRequest {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version shown. */
  readonly version: number;
  /** The question. */
  readonly question: string;
  /** The variables chosen; defaults fill the rest. */
  readonly variables: VariableValues;
  /** The range shown; the spec's default when left out. */
  readonly time?: TimeRangeExpression | undefined;
  /** The sets of markers hidden. */
  readonly hiddenMarkers: readonly string[];
  /** The browser's time zone, for a dashboard that names none. */
  readonly timeZone: string;
  /** The question it follows up on. */
  readonly parentId?: string | undefined;
}

/** A question ready to answer: everything the answer and the stored record need. */
export interface PreparedQuestion {
  /** The id it will be stored with. */
  readonly id: string;
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
  /** The version's spec. */
  readonly spec: DashboardSpec;
  /** The range shown, resolved. */
  readonly time: ResolvedTimeRange;
  /** The time zone the answer names times in. */
  readonly timeZone: string;
  /** The variable values shown. */
  readonly variables: VariableValues;
  /** The sets of markers hidden. */
  readonly hiddenMarkers: readonly string[];
  /** Whether no source of the dashboard shows numbers. */
  readonly explainOnly: boolean;
  /** The question. */
  readonly question: string;
  /** The question it follows up on. */
  readonly parentId: string | null;
  /** The earlier questions and answers of its chain, oldest first. */
  readonly history: readonly { readonly question: string; readonly answer: string }[];
  /** Who asks, by user id. */
  readonly askedBy: string;
  /** When. */
  readonly askedAt: number;
}

/** How an answer ended, as the answering service reports it. */
export type AnsweredOutcome =
  | { readonly ok: true; readonly answer: Answer; readonly usage: TurnUsage }
  | {
      readonly ok: false;
      readonly message: string;
      readonly evidence: readonly AnswerEvidence[];
      readonly usage: TurnUsage;
    };

/** A stored question, naming its asker by user id. */
export type QuestionInfo = Omit<DashboardQuestion, 'askedBy'> & {
  /** The user id of whoever asked. */
  readonly askerId: string;
};

/** The questions service. */
export interface Questions {
  /**
   * Prepares a question about a pinned version: resolves the range and the variables shown, and
   * gathers the chain it follows up on.
   *
   * @param request - The question and what the dashboard shows.
   * @param actor - Who asks.
   * @returns The prepared question.
   * @throws {AppError} `not_found` for a version viewers may not see or an unknown parent,
   *   `bad_request` for an unknown time zone.
   */
  prepare(request: QuestionRequest, actor: string): PreparedQuestion;
  /**
   * Stores a question with its outcome.
   *
   * @param prepared - The question.
   * @param outcome - How its answer ended.
   */
  record(prepared: PreparedQuestion, outcome: AnsweredOutcome): void;
  /**
   * Lists a dashboard's questions, the newest first.
   *
   * @param dashboardId - The dashboard.
   * @param role - The role the dashboard is read with.
   * @returns The questions.
   * @throws {AppError} `not_found` for a dashboard the role may not see.
   */
  list(dashboardId: string, role: Role): QuestionInfo[];
  /**
   * Reads one question.
   *
   * @param dashboardId - The dashboard.
   * @param questionId - The question.
   * @param role - The role the dashboard is read with.
   * @returns The question.
   * @throws {AppError} `not_found`.
   */
  get(dashboardId: string, questionId: string, role: Role): QuestionInfo;
  /**
   * Finds earlier answered questions whose question or answer shares words with a text.
   *
   * @param dashboardId - The dashboard.
   * @param text - The text being typed.
   * @param role - The role the dashboard is read with.
   * @returns At most three, the best first.
   */
  similar(dashboardId: string, text: string, role: Role): QuestionInfo[];
  /**
   * The sources a version reads, by name and access level.
   *
   * @param target - The dashboard and version.
   * @param role - The role the version is read with.
   * @returns One per connector the spec names, in order of first use.
   */
  sources(target: { dashboardId: string; version: number }, role: Role): DashboardSource[];
}

/** What the questions service needs besides the dashboards' context. */
export interface QuestionsDependencies {
  /** Stores questions. */
  readonly questions: QuestionRepository;
  /** The configured connectors' names and access levels. */
  readonly connectorLevels: () => readonly { name: string; accessLevel: number }[];
}

/** The service's context. */
type QuestionContext = ServiceContext & QuestionsDependencies;

/**
 * The connectors a spec names: in its panels, its markers and its query-backed variables.
 *
 * @param spec - The spec.
 * @returns The names, in order of first use.
 */
function connectorNamesOf(spec: DashboardSpec): string[] {
  return [
    ...new Set([
      ...spec.panels.flatMap((panel) => panel.queries.map((query) => query.connector)),
      ...spec.annotations.map((annotation) => annotation.query.connector),
      ...spec.variables.flatMap((variable) =>
        variable.kind === 'query' ? [variable.source.connector] : [],
      ),
    ]),
  ];
}

/**
 * The sources of a spec with their access levels.
 *
 * @param context - The service context.
 * @param spec - The spec.
 * @returns The sources.
 */
function sourcesOf(context: QuestionContext, spec: DashboardSpec): DashboardSource[] {
  const levels = new Map(context.connectorLevels().map((each) => [each.name, each.accessLevel]));
  return connectorNamesOf(spec).map((name) => {
    const level = levels.get(name);
    const accessLevel = level === 1 || level === 2 || level === 3 || level === 4 ? level : null;
    return { name, accessLevel };
  });
}

/**
 * Checks a time zone is one the runtime knows.
 *
 * @param timeZone - An IANA time zone.
 * @returns The zone.
 * @throws {AppError} `bad_request` for an unknown one.
 */
function knownTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    throw new AppError('bad_request', `Unknown time zone "${timeZone}".`);
  }
}

/**
 * The earlier questions and answers of a chain, oldest first: the answered ones, at most
 * {@link maxHistory}.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard the chain must be on.
 * @param parentId - The question followed up on.
 * @returns The history.
 * @throws {AppError} `not_found` for a parent of another dashboard or none.
 */
function historyOf(context: QuestionContext, dashboardId: string, parentId: string) {
  const parent = context.questions.get(parentId);
  if (parent?.dashboardId !== dashboardId)
    throw new AppError('not_found', `No question ${parentId} on this dashboard.`);
  const chain: { question: string; answer: string }[] = [];
  for (let row: QuestionRow | undefined = parent; row && chain.length < maxHistory; ) {
    if (row.answer !== null) chain.unshift({ question: row.question, answer: row.answer });
    row = row.parentId === null ? undefined : context.questions.get(row.parentId);
  }
  return chain;
}

/**
 * Prepares a question.
 *
 * @param context - The service context.
 * @param request - The question and what the dashboard shows.
 * @param actor - Who asks.
 * @returns The prepared question.
 */
function prepare(context: QuestionContext, request: QuestionRequest, actor: string) {
  // Questions are about what everyone may see: a pinned version of a pinned dashboard.
  const spec = specOf(context, request, 'viewer');
  const known = new Set(spec.annotations.map((annotation) => annotation.id));
  const { parentId } = request;
  return {
    id: newId(),
    dashboardId: request.dashboardId,
    version: request.version,
    spec,
    time: resolveTimeRange(request.time ?? spec.time, context.now()),
    timeZone: knownTimeZone(spec.timezone ?? request.timeZone),
    variables: shownVariables(spec, request.variables),
    hiddenMarkers: [...new Set(request.hiddenMarkers)].filter((id) => known.has(id)),
    explainOnly: !sourcesOf(context, spec).some(({ accessLevel }) => (accessLevel ?? 0) >= 3),
    question: request.question,
    parentId: parentId ?? null,
    history: parentId === undefined ? [] : historyOf(context, request.dashboardId, parentId),
    askedBy: actor,
    askedAt: context.now(),
  } satisfies PreparedQuestion;
}

/**
 * The row of a question and its outcome.
 *
 * @param prepared - The question.
 * @param outcome - How its answer ended.
 * @returns The row.
 */
function rowOf(prepared: PreparedQuestion, outcome: AnsweredOutcome): QuestionRow {
  const tokens = Object.values(outcome.usage).reduce(
    (sum, each) => sum + each.input + each.cachedInput + each.cacheWrite + each.output,
    0,
  );
  const { time, spec: _spec, history: _history, ...asked } = prepared;
  return {
    ...asked,
    timeFrom: time.from,
    timeTo: time.to,
    answer: outcome.ok ? outcome.answer.text : null,
    failure: outcome.ok ? null : outcome.message,
    citations: outcome.ok ? outcome.answer.citations : [],
    evidence: outcome.ok ? outcome.answer.evidence : outcome.evidence,
    usage: outcome.usage,
    tokens,
  };
}

/**
 * A stored question as the service gives it.
 *
 * @param row - The stored question.
 * @returns The question, naming its asker by id.
 */
function infoOf(row: QuestionRow): QuestionInfo {
  const outcome =
    row.answer === null
      ? { ok: false, message: row.failure ?? '', evidence: row.evidence }
      : {
          ok: true,
          answer: {
            mode: 'ask',
            text: row.answer,
            citations: row.citations,
            evidence: row.evidence,
          },
        };
  const parsed = dashboardQuestionSchema.parse({
    ...row,
    time: { from: row.timeFrom, to: row.timeTo },
    outcome,
  });
  const { askedBy, ...rest } = parsed;
  return { ...rest, askerId: askedBy };
}

/**
 * Finds a question of a dashboard the role may see.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param questionId - The question.
 * @param role - The role the dashboard is read with.
 * @returns The question.
 */
function questionOf(context: QuestionContext, dashboardId: string, questionId: string, role: Role) {
  get(context, dashboardId, role);
  const row = context.questions.get(questionId);
  if (row?.dashboardId !== dashboardId)
    throw new AppError('not_found', `No question ${questionId} on this dashboard.`);
  return infoOf(row);
}

/**
 * Finds earlier answered questions sharing words with a text.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param text - The text.
 * @param role - The role the dashboard is read with.
 * @returns The questions, the best first.
 */
function similar(context: QuestionContext, dashboardId: string, text: string, role: Role) {
  get(context, dashboardId, role);
  const words = [...meaningfulWords(text)];
  return context.questions.search(dashboardId, words, maxSimilar).flatMap(({ id }) => {
    const row = context.questions.get(id);
    return row ? [infoOf(row)] : [];
  });
}

/**
 * Creates the service.
 *
 * @param dependencies - The dashboards' context, the questions' store and the connectors' levels.
 * @returns The service.
 */
export function createQuestions(
  dependencies: DashboardsDependencies & QuestionsDependencies,
): Questions {
  const context: QuestionContext = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    prepare: (request, actor) => prepare(context, request, actor),
    record: (prepared, outcome) => context.questions.insert(rowOf(prepared, outcome)),
    list: (dashboardId, role) => {
      get(context, dashboardId, role);
      return context.questions.list(dashboardId, maxListed).map(infoOf);
    },
    get: (dashboardId, questionId, role) => questionOf(context, dashboardId, questionId, role),
    similar: (dashboardId, text, role) => similar(context, dashboardId, text, role),
    sources: (target, role) =>
      sourcesOf(context, specOf(context, { ...target, variables: {} }, role)),
  };
}
