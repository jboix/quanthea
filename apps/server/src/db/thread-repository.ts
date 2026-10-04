/** Reads and writes threads, their messages and their plans. */
import type { Database } from 'bun:sqlite';
import type { AlertSeed, ThreadKind, ThreadQueries } from '@quanthea/shared';
import { queriesOf, seedOf } from './thread-json.ts';

/** A thread state, as stored. */
type StoredState = 'idle' | 'plan_pending' | 'building' | 'ready';

/** A thread as stored. */
export interface ThreadRow {
  /** The ULID. */
  readonly id: string;
  /** The title, from the first question or the plan. */
  readonly title: string | null;
  /** Where the thread is in its state machine. */
  readonly state: StoredState;
  /** The dashboard the thread authors, once it has one. */
  readonly dashboardId: string | null;
  /** Tokens spent on the thread so far. */
  readonly tokensUsed: number;
  /** Who started it. */
  readonly createdBy: string | null;
  /** The model provider it uses; `null` for the default. */
  readonly providerId: string | null;
  /** The query builders and saved queries it uses. */
  readonly queries: ThreadQueries;
  /** What it makes: a dashboard, an alert or a report. */
  readonly kind: ThreadKind;
  /** For an alert thread, the panel it starts from. */
  readonly seed: AlertSeed | null;
  /** The alert it makes, once it saved a first version; read, never written here. */
  readonly alertId: string | null;
  /** Whether an alert it made has an active version and is not deactivated; read only. */
  readonly alertActive: boolean;
  /** The report it makes, once it saved a first version; read, never written here. */
  readonly reportId: string | null;
  /** Whether a report it made has an active version and is not deactivated; read only. */
  readonly reportActive: boolean;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
  /** Last change, in epoch milliseconds. */
  readonly updatedAt: number;
}

/** A message as stored: an AI SDK UI message. */
export interface MessageRow {
  /** The message id. */
  readonly id: string;
  /** `user`, `assistant` or `system`. */
  readonly role: string;
  /** The message parts, parsed from JSON. */
  readonly parts: unknown;
  /** The message metadata, if any. */
  readonly metadata: unknown;
  /** Who wrote it, for user messages. */
  readonly actor: string | null;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
}

/** What became of a plan. */
export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

/** A plan as stored. */
export interface PlanRow {
  /** The ULID. */
  readonly id: string;
  /** The thread. */
  readonly threadId: string;
  /** The plan, parsed from JSON. */
  readonly body: unknown;
  /** What became of it. */
  readonly status: PlanStatus;
  /** Who approved or rejected it. */
  readonly decidedBy: string | null;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
  /** When it was decided. */
  readonly decidedAt: number | null;
}

/** The fields a thread update may change. */
export type ThreadChange = Partial<
  Pick<ThreadRow, 'title' | 'state' | 'dashboardId' | 'tokensUsed'>
> & {
  /** The time of the change. */
  readonly updatedAt: number;
};

/** Stores threads. */
export interface ThreadRepository {
  /**
   * Inserts a thread.
   *
   * @param row - The thread.
   */
  create(row: ThreadRow): void;
  /**
   * Finds a thread outside the bin.
   *
   * @param id - The thread id.
   * @returns The thread, or `undefined`, also when it is in the bin.
   */
  get(id: string): ThreadRow | undefined;
  /**
   * Lists the threads outside the bin, the most recently changed first.
   *
   * @returns The threads.
   */
  list(): ThreadRow[];
  /**
   * Changes a thread.
   *
   * @param id - The thread id.
   * @param change - The fields to change and the time.
   */
  update(id: string, change: ThreadChange): void;
  /**
   * Deletes a thread with its messages and plans. Its dashboard stays.
   *
   * @param id - The thread id.
   * @returns `true` when a thread was deleted.
   */
  remove(id: string): boolean;
  /**
   * Reads a thread's messages.
   *
   * @param threadId - The thread id.
   * @returns The messages, in order.
   */
  messages(threadId: string): MessageRow[];
  /**
   * Replaces a thread's messages with the given list, in one transaction.
   *
   * @param threadId - The thread id.
   * @param messages - The whole conversation, in order.
   */
  saveMessages(threadId: string, messages: readonly MessageRow[]): void;
  /**
   * Inserts a plan.
   *
   * @param row - The plan.
   */
  addPlan(row: PlanRow): void;
  /**
   * Finds a plan.
   *
   * @param id - The plan id.
   * @returns The plan, or `undefined`.
   */
  plan(id: string): PlanRow | undefined;
  /**
   * Lists a thread's plans.
   *
   * @param threadId - The thread id.
   * @returns The plans, oldest first.
   */
  plans(threadId: string): PlanRow[];
  /**
   * Decides a plan that is pending.
   *
   * @param id - The plan id.
   * @param status - What became of it.
   * @param decidedBy - Who decided, if a person did.
   * @param at - When.
   * @returns `false` when the plan was not pending.
   */
  decidePlan(id: string, status: PlanStatus, decidedBy: string | null, at: number): boolean;
}

/** A `threads` row as SQLite returns it. */
interface StoredThread {
  /** The id. */
  id: string;
  /** The title. */
  title: string | null;
  /** The state. */
  state: StoredState;
  /** The dashboard. */
  dashboard_id: string | null;
  /** Tokens spent. */
  tokens_used: number;
  /** The creator. */
  created_by: string | null;
  /** The model provider. */
  provider_id: string | null;
  /** The queries, as JSON. */
  recipes: string | null;
  /** What it makes. */
  kind: ThreadKind;
  /** The panel an alert thread starts from, as JSON. */
  seed: string | null;
  /** The alert it made, from the alerts that name it. */
  alert_id: string | null;
  /** 1 when an alert it made is active. */
  alert_active: number;
  /** The report it made, from the reports that name it. */
  report_id: string | null;
  /** 1 when a report it made is active. */
  report_active: number;
  /** Creation time. */
  created_at: number;
  /** Last change. */
  updated_at: number;
}

/** A `messages` row as SQLite returns it. */
interface StoredMessage {
  /** The id. */
  id: string;
  /** The role. */
  role: string;
  /** The parts JSON. */
  parts: string;
  /** The metadata JSON. */
  metadata: string | null;
  /** The actor. */
  actor: string | null;
  /** Creation time. */
  created_at: number;
}

/** A `plans` row as SQLite returns it. */
interface StoredPlan {
  /** The id. */
  id: string;
  /** The thread. */
  thread_id: string;
  /** The body JSON. */
  body: string;
  /** The status. */
  status: PlanStatus;
  /** Who decided. */
  decided_by: string | null;
  /** Creation time. */
  created_at: number;
  /** Decision time. */
  decided_at: number | null;
}

/**
 * Turns a stored row into a thread.
 *
 * @param stored - The row.
 * @returns The thread.
 */
function toThread(stored: StoredThread): ThreadRow {
  return {
    id: stored.id,
    title: stored.title,
    state: stored.state,
    dashboardId: stored.dashboard_id,
    tokensUsed: stored.tokens_used,
    createdBy: stored.created_by,
    providerId: stored.provider_id,
    queries: queriesOf(stored.recipes),
    kind: stored.kind,
    seed: seedOf(stored.seed),
    alertId: stored.alert_id,
    alertActive: stored.alert_active === 1,
    reportId: stored.report_id,
    reportActive: stored.report_active === 1,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  };
}

/**
 * Turns a stored row into a plan.
 *
 * @param stored - The row.
 * @returns The plan.
 */
function toPlan(stored: StoredPlan): PlanRow {
  return {
    id: stored.id,
    threadId: stored.thread_id,
    body: JSON.parse(stored.body),
    status: stored.status,
    decidedBy: stored.decided_by,
    createdAt: stored.created_at,
    decidedAt: stored.decided_at,
  };
}

/**
 * A thread's columns, with its first alert and its first report, and whether an alert or a report
 * it made is active.
 */
const threadColumns = `t.*, (SELECT a.id FROM alerts a WHERE a.thread_id = t.id
  ORDER BY a.created_at, a.id LIMIT 1) AS alert_id, EXISTS (SELECT 1 FROM alerts a WHERE
  a.thread_id = t.id AND a.active_version IS NOT NULL AND a.deactivated_at IS NULL) AS alert_active,
  (SELECT r.id FROM reports r WHERE r.thread_id = t.id ORDER BY r.created_at, r.id LIMIT 1)
  AS report_id, EXISTS (SELECT 1 FROM reports r WHERE r.thread_id = t.id
  AND r.active_version IS NOT NULL AND r.deactivated_at IS NULL) AS report_active`;

/**
 * Prepares the statements on threads.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function threadStatements(database: Database) {
  return {
    insert: database.query(
      `INSERT INTO threads (id, title, state, dashboard_id, tokens_used, created_by, provider_id,
         recipes, kind, seed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    // A thread in the bin is out of reach until it is restored (db/thread-bin.ts).
    selectOne: database.query<StoredThread, [string]>(
      `SELECT ${threadColumns} FROM threads t WHERE t.id = ? AND t.deleted_at IS NULL`,
    ),
    selectAll: database.query<StoredThread, []>(
      `SELECT ${threadColumns} FROM threads t WHERE t.deleted_at IS NULL
       ORDER BY t.updated_at DESC, t.id DESC`,
    ),
    update: database.query(
      `UPDATE threads SET title = coalesce(?, title), state = coalesce(?, state),
         dashboard_id = coalesce(?, dashboard_id), tokens_used = coalesce(?, tokens_used),
         updated_at = ? WHERE id = ?`,
    ),
    remove: database.query('DELETE FROM threads WHERE id = ?'),
  };
}

/**
 * The values of a thread insert, in column order.
 *
 * @param row - The thread.
 * @returns The values.
 */
function threadValues(row: ThreadRow) {
  const { id, title, state, dashboardId, tokensUsed, createdBy, providerId } = row;
  return [
    id,
    title,
    state,
    dashboardId,
    tokensUsed,
    createdBy,
    providerId,
    JSON.stringify(row.queries),
    row.kind,
    row.seed === null ? null : JSON.stringify(row.seed),
    row.createdAt,
    row.updatedAt,
  ] as const;
}

/**
 * The values of a thread update, in statement order. A missing field keeps its value.
 *
 * @param id - The thread id.
 * @param change - The change.
 * @returns The values.
 */
function changeValues(id: string, change: ThreadChange) {
  const { title, state, dashboardId, tokensUsed, updatedAt } = change;
  return [
    title ?? null,
    state ?? null,
    dashboardId ?? null,
    tokensUsed ?? null,
    updatedAt,
    id,
  ] as const;
}

/**
 * The thread half of the repository.
 *
 * @param database - A database the migrations have run on.
 * @returns The thread methods.
 */
function threadMethods(
  database: Database,
): Pick<ThreadRepository, 'create' | 'get' | 'list' | 'update' | 'remove'> {
  const statements = threadStatements(database);
  return {
    create: (row) => {
      statements.insert.run(...threadValues(row));
    },
    get: (id) => {
      const stored = statements.selectOne.get(id);
      return stored ? toThread(stored) : undefined;
    },
    list: () => statements.selectAll.all().map(toThread),
    update: (id, change) => {
      statements.update.run(...changeValues(id, change));
    },
    remove: (id) => statements.remove.run(id).changes > 0,
  };
}

/**
 * Turns a stored row into a message.
 *
 * @param stored - The row.
 * @returns The message.
 */
function toMessage(stored: StoredMessage): MessageRow {
  return {
    id: stored.id,
    role: stored.role,
    parts: JSON.parse(stored.parts),
    metadata: stored.metadata === null ? undefined : JSON.parse(stored.metadata),
    actor: stored.actor,
    createdAt: stored.created_at,
  };
}

/**
 * Builds the transaction that replaces a thread's messages.
 *
 * @param database - A database the migrations have run on.
 * @returns The save method.
 */
function messageSaver(database: Database): ThreadRepository['saveMessages'] {
  const clear = database.query('DELETE FROM messages WHERE thread_id = ?');
  const insert = database.query(
    `INSERT INTO messages (id, thread_id, position, role, parts, metadata, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return database.transaction((threadId: string, messages: readonly MessageRow[]) => {
    clear.run(threadId);
    messages.forEach((message, position) => {
      const metadata = message.metadata === undefined ? null : JSON.stringify(message.metadata);
      insert.run(
        message.id,
        threadId,
        position,
        message.role,
        JSON.stringify(message.parts),
        metadata,
        message.actor,
        message.createdAt,
      );
    });
  });
}

/**
 * The message half of the repository.
 *
 * @param database - A database the migrations have run on.
 * @returns The message methods.
 */
function messageMethods(database: Database): Pick<ThreadRepository, 'messages' | 'saveMessages'> {
  const select = database.query<StoredMessage, [string]>(
    `SELECT id, role, parts, metadata, actor, created_at FROM messages WHERE thread_id = ?
     ORDER BY position`,
  );
  return {
    messages: (threadId) => select.all(threadId).map(toMessage),
    saveMessages: messageSaver(database),
  };
}

/**
 * Prepares the statements on plans.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function planStatements(database: Database) {
  return {
    insert: database.query(
      `INSERT INTO plans (id, thread_id, body, status, decided_by, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectOne: database.query<StoredPlan, [string]>('SELECT * FROM plans WHERE id = ?'),
    selectAll: database.query<StoredPlan, [string]>(
      'SELECT * FROM plans WHERE thread_id = ? ORDER BY created_at, id',
    ),
    decide: database.query(
      "UPDATE plans SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
    ),
  };
}

/**
 * The plan half of the repository.
 *
 * @param database - A database the migrations have run on.
 * @returns The plan methods.
 */
function planMethods(
  database: Database,
): Pick<ThreadRepository, 'addPlan' | 'plan' | 'plans' | 'decidePlan'> {
  const statements = planStatements(database);
  return {
    addPlan: (row) => {
      statements.insert.run(
        row.id,
        row.threadId,
        JSON.stringify(row.body),
        row.status,
        row.decidedBy,
        row.createdAt,
        row.decidedAt,
      );
    },
    plan: (id) => {
      const stored = statements.selectOne.get(id);
      return stored ? toPlan(stored) : undefined;
    },
    plans: (threadId) => statements.selectAll.all(threadId).map(toPlan),
    decidePlan: (id, status, decidedBy, at) =>
      statements.decide.run(status, decidedBy, at, id).changes > 0,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createThreadRepository(database: Database): ThreadRepository {
  return {
    ...threadMethods(database),
    ...messageMethods(database),
    ...planMethods(database),
  };
}
