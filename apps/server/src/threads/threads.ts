/**
 * The threads service: threads, their messages and their plans, with the state machine checked on
 * every change. The agent and the HTTP layer both go through it.
 */
import type {
  AlertPlan,
  AlertSeed,
  Plan,
  PlanView,
  ThreadDetail,
  ThreadKind,
  ThreadQueries,
  ThreadSummary,
} from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { MessageRow, PlanRow, ThreadRepository, ThreadRow } from '../db/thread-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { nextState, type ThreadEvent, type ThreadState } from './state.ts';

/** A thread with its conversation, as the service knows it; the HTTP layer adds the rest. */
export type ThreadConversation = Omit<
  ThreadDetail,
  'model' | 'providerName' | 'connectors' | 'ownerName' | 'readOnly'
>;

/** A message as the AI SDK hands it over: id, role, parts and metadata. */
export interface StoredMessage {
  /** The message id. */
  readonly id: string;
  /** `user`, `assistant` or `system`. */
  readonly role: string;
  /** The parts. */
  readonly parts: unknown;
  /** The metadata, if any. */
  readonly metadata?: unknown;
}

/** A plan of either kind of thread. */
type AnyPlan = Plan | AlertPlan;

/** What a new thread makes, and the panel an alert thread starts from. */
export interface ThreadStart {
  /** A dashboard or an alert. */
  readonly kind: ThreadKind;
  /** The panel an alert thread starts from, if any. */
  readonly seed?: AlertSeed | undefined;
}

/** What the service needs. */
export interface ThreadsDependencies {
  /** Stores threads. */
  readonly repository: ThreadRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The threads service. */
export interface Threads {
  /**
   * Lists the threads, the most recently changed first.
   *
   * @returns The threads.
   */
  list(): ThreadSummary[];
  /**
   * Starts a thread.
   *
   * @param actor - Who starts it.
   * @param providerId - The model provider; the default one when left out.
   * @param queries - The queries it may use; the default set when left out.
   * @param start - What it makes, a dashboard by default, and the panel an alert starts from.
   * @returns The thread.
   */
  create(
    actor: string,
    providerId?: string | null,
    queries?: ThreadQueries,
    start?: ThreadStart,
  ): ThreadSummary;
  /**
   * Reads a thread with its messages and plans.
   *
   * @param id - The thread id.
   * @returns The thread.
   * @throws {AppError} `not_found`.
   */
  get(id: string): ThreadConversation;
  /**
   * Reads a thread's stored row.
   *
   * @param id - The thread id.
   * @returns The row.
   * @throws {AppError} `not_found`.
   */
  row(id: string): ThreadRow;
  /**
   * Deletes a thread with its messages and plans. Its dashboard stays.
   *
   * @param id - The thread id.
   * @param actor - Who deletes it.
   */
  remove(id: string, actor: string): void;
  /**
   * Moves a thread through its state machine.
   *
   * @param id - The thread id.
   * @param event - What happened.
   * @returns The new state.
   * @throws {AppError} `bad_request` when the event is not allowed in the current state.
   */
  apply(id: string, event: ThreadEvent): ThreadState;
  /**
   * Replaces the thread's messages with the whole conversation.
   *
   * @param id - The thread id.
   * @param messages - The conversation, in order.
   * @param actor - Who wrote the user messages that are new.
   */
  saveMessages(id: string, messages: readonly StoredMessage[], actor: string): void;
  /**
   * Records a proposed plan and moves the thread to waiting for approval, or straight to
   * building when approval is off. A pending plan it replaces is superseded.
   *
   * @param id - The thread id.
   * @param body - The plan.
   * @param autoApprove - Whether plans are approved without asking.
   * @returns The plan.
   */
  proposePlan(id: string, body: AnyPlan, autoApprove: boolean): PlanView;
  /**
   * Approves or rejects the pending plan.
   *
   * @param id - The thread id.
   * @param planId - The plan.
   * @param decision - Approve or reject.
   * @param actor - Who decides.
   * @returns The thread.
   * @throws {AppError} `not_found` for another thread's plan, `bad_request` when it is not pending.
   */
  decidePlan(
    id: string,
    planId: string,
    decision: 'approve' | 'reject',
    actor: string,
  ): ThreadSummary;
  /**
   * Records the dashboard the thread authors, and its title when the thread has none.
   *
   * @param id - The thread id.
   * @param dashboardId - The dashboard.
   * @param title - The dashboard's title.
   */
  attachDashboard(id: string, dashboardId: string, title: string): void;
  /**
   * Names a thread that has no title yet.
   *
   * @param id - The thread id.
   * @param title - The title, such as the first question.
   */
  name(id: string, title: string): void;
  /**
   * Adds the tokens a run spent.
   *
   * @param id - The thread id.
   * @param tokens - The tokens.
   */
  addTokens(id: string, tokens: number): void;
}

/** The service's dependencies with the clock resolved. */
type Context = ThreadsDependencies & { readonly now: () => number };

/**
 * When a thread was created and last changed.
 *
 * @param row - The thread.
 * @returns The times.
 */
function timesOf(row: ThreadRow) {
  return { createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/**
 * The summary of a thread.
 *
 * @param row - The thread.
 * @returns The summary.
 */
function toSummary(row: ThreadRow): ThreadSummary {
  const { id, title, state, kind, dashboardId, alertId, tokensUsed, providerId, queries } = row;
  const summary = { id, title, state, kind, dashboardId, alertId, tokensUsed, providerId, queries };
  return { ...summary, ownerId: row.createdBy, ...timesOf(row) };
}

/**
 * The view of a plan.
 *
 * @param row - The plan.
 * @returns The view.
 */
function toPlanView(row: PlanRow): PlanView {
  const { id, status, decidedBy, createdAt, decidedAt } = row;
  return { id, status, body: row.body as AnyPlan, decidedBy, createdAt, decidedAt };
}

/**
 * Finds a thread.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @returns The thread.
 * @throws {AppError} `not_found`.
 */
function find(context: Context, id: string): ThreadRow {
  const row = context.repository.get(id);
  if (!row) throw new AppError('not_found', `No thread ${id}.`);
  return row;
}

/**
 * Moves a thread through its state machine.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @param event - What happened.
 * @returns The new state.
 */
function apply(context: Context, id: string, event: ThreadEvent): ThreadState {
  const row = find(context, id);
  const state = nextState(row.state, event);
  if (state === undefined) {
    throw new AppError('bad_request', `A thread in state "${row.state}" cannot ${event}.`);
  }
  context.repository.update(id, { state, updatedAt: context.now() });
  return state;
}

/**
 * Records a proposed plan.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @param body - The plan.
 * @param autoApprove - Whether plans are approved without asking.
 * @returns The plan.
 */
function proposePlan(context: Context, id: string, body: AnyPlan, autoApprove: boolean): PlanView {
  apply(context, id, 'propose');
  const at = context.now();
  for (const plan of context.repository.plans(id).filter((each) => each.status === 'pending')) {
    context.repository.decidePlan(plan.id, 'superseded', null, at);
  }
  const plan: PlanRow = {
    id: newId(),
    threadId: id,
    body,
    status: 'pending',
    decidedBy: null,
    createdAt: at,
    decidedAt: null,
  };
  context.repository.addPlan(plan);
  if (!autoApprove) return toPlanView(plan);
  context.repository.decidePlan(plan.id, 'approved', null, at);
  apply(context, id, 'approve');
  return toPlanView({ ...plan, status: 'approved', decidedAt: at });
}

/**
 * Approves or rejects a pending plan.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @param planId - The plan.
 * @param decision - Approve or reject.
 * @param actor - Who decides.
 * @returns The thread.
 */
function decidePlan(
  context: Context,
  id: string,
  planId: string,
  decision: 'approve' | 'reject',
  actor: string,
) {
  const plan = context.repository.plan(planId);
  if (!plan || plan.threadId !== id)
    throw new AppError('not_found', `No plan ${planId} in thread ${id}.`);
  if (plan.status !== 'pending')
    throw new AppError('bad_request', `The plan is ${plan.status} already.`);
  apply(context, id, decision);
  context.repository.decidePlan(
    planId,
    decision === 'approve' ? 'approved' : 'rejected',
    actor,
    context.now(),
  );
  context.audit.append({ actor, action: `plan.${decision}`, target: id, detail: { planId } });
  return toSummary(find(context, id));
}

/**
 * Stores the conversation, keeping the time and author of the messages already stored.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @param messages - The conversation.
 * @param actor - Who wrote the new user messages.
 */
function saveMessages(
  context: Context,
  id: string,
  messages: readonly StoredMessage[],
  actor: string,
): void {
  find(context, id);
  const stored = new Map(context.repository.messages(id).map((row) => [row.id, row]));
  const at = context.now();
  const rows: MessageRow[] = messages.map((message) => {
    const known = stored.get(message.id);
    const author = message.role === 'user' ? actor : null;
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
      actor: known?.actor ?? author,
      createdAt: known?.createdAt ?? at,
    };
  });
  context.repository.saveMessages(id, rows);
  context.repository.update(id, { updatedAt: at });
}

/**
 * Starts a thread.
 *
 * @param context - The service context.
 * @param actor - Who starts it.
 * @param providerId - The model provider, or `null` for the default.
 * @param queries - The queries it may use.
 * @param start - What it makes, and the panel an alert starts from.
 * @returns The thread.
 */
function create(
  context: Context,
  actor: string,
  providerId: string | null,
  queries: ThreadQueries,
  start: ThreadStart,
): ThreadSummary {
  const at = context.now();
  const row: ThreadRow = {
    id: newId(),
    title: null,
    state: 'idle',
    dashboardId: null,
    tokensUsed: 0,
    createdBy: actor,
    providerId,
    queries,
    kind: start.kind,
    seed: start.kind === 'alert' ? (start.seed ?? null) : null,
    alertId: null,
    createdAt: at,
    updatedAt: at,
  };
  context.repository.create(row);
  return toSummary(row);
}

/**
 * Reads a thread with its messages and plans.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @returns The thread.
 */
function get(context: Context, id: string): ThreadConversation {
  const messages = context.repository
    .messages(id)
    .map(({ id: messageId, role, parts, metadata }) => ({
      id: messageId,
      role,
      parts,
      ...(metadata === undefined ? {} : { metadata }),
    }));
  return {
    ...toSummary(find(context, id)),
    messages,
    plans: context.repository.plans(id).map(toPlanView),
  };
}

/**
 * Changes fields of a thread that exists.
 *
 * @param context - The service context.
 * @param id - The thread id.
 * @param compute - Computes the fields from the current row.
 */
function change(
  context: Context,
  id: string,
  compute: (row: ThreadRow) => Partial<ThreadRow>,
): void {
  const row = find(context, id);
  context.repository.update(id, { ...compute(row), updatedAt: context.now() });
}

/**
 * Creates the service.
 *
 * @param dependencies - The repository, the audit log and the clock.
 * @returns The service.
 */
export function createThreads(dependencies: ThreadsDependencies): Threads {
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now };
  const { repository } = context;
  return {
    list: () => repository.list().map(toSummary),
    create: (actor, providerId, queries, start) =>
      create(context, actor, providerId ?? null, queries ?? { mode: 'default' }, {
        kind: 'dashboard',
        ...start,
      }),
    get: (id) => get(context, id),
    row: (id) => find(context, id),
    remove(id, actor) {
      if (!repository.remove(id)) throw new AppError('not_found', `No thread ${id}.`);
      context.audit.append({ actor, action: 'thread.delete', target: id });
    },
    apply: (id, event) => apply(context, id, event),
    saveMessages: (id, messages, actor) => saveMessages(context, id, messages, actor),
    proposePlan: (id, body, autoApprove) => proposePlan(context, id, body, autoApprove),
    decidePlan: (id, planId, decision, actor) => decidePlan(context, id, planId, decision, actor),
    attachDashboard: (id, dashboardId, title) =>
      change(context, id, (row) => ({ dashboardId, ...(row.title === null ? { title } : {}) })),
    addTokens: (id, tokens) =>
      change(context, id, (row) => ({ tokensUsed: row.tokensUsed + tokens })),
    name: (id, title) => change(context, id, (row) => (row.title === null ? { title } : {})),
  };
}
