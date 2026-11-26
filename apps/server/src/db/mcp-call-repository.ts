/** Stores what API tokens did on the MCP endpoint: one row per tool call. */
import type { Database } from 'bun:sqlite';
import type { McpCallOutcome, Role } from '@quanthea/shared';

/** A tool call as stored. */
export interface McpCallRow {
  /** The row's id. */
  readonly id: string;
  /** When the call ended. */
  readonly at: number;
  /** The public id of the token it came with. */
  readonly tokenId: string;
  /** The token's name then. */
  readonly tokenName: string;
  /** The token's owner. */
  readonly userId: string;
  /** The role the call acted with. */
  readonly role: Role;
  /** The tool, as the caller named it. */
  readonly tool: string;
  /** The arguments as JSON, cut when long. */
  readonly arguments: string;
  /** How the call ended. */
  readonly outcome: McpCallOutcome;
  /** How long it took. */
  readonly durationMs: number;
  /** Where the request came from. */
  readonly address: string;
}

/** Stores tool calls. */
export interface McpCallRepository {
  /**
   * Inserts a call.
   *
   * @param row - The call.
   */
  record(row: McpCallRow): void;
  /**
   * The latest calls.
   *
   * @param limit - How many at most.
   * @returns The calls, the newest first.
   */
  latest(limit: number): McpCallRow[];
  /**
   * Deletes the calls before a time.
   *
   * @param before - The time.
   * @returns How many were deleted.
   */
  removeBefore(before: number): number;
}

/** A call as SQLite returns it. */
interface StoredCall {
  /** The id. */
  id: string;
  /** When. */
  at: number;
  /** The token's public id. */
  token_id: string;
  /** The token's name. */
  token_name: string;
  /** The user. */
  user_id: string;
  /** The role. */
  role: Role;
  /** The tool. */
  tool: string;
  /** The arguments. */
  arguments: string;
  /** The outcome. */
  outcome: McpCallOutcome;
  /** The duration. */
  duration_ms: number;
  /** The address. */
  address: string;
}

/**
 * Turns a stored row into a call.
 *
 * @param stored - The row.
 * @returns The call.
 */
function toCall(stored: StoredCall): McpCallRow {
  return {
    id: stored.id,
    at: stored.at,
    tokenId: stored.token_id,
    tokenName: stored.token_name,
    userId: stored.user_id,
    role: stored.role,
    tool: stored.tool,
    arguments: stored.arguments,
    outcome: stored.outcome,
    durationMs: stored.duration_ms,
    address: stored.address,
  };
}

/**
 * The statement that stores a call.
 *
 * @param database - The database.
 * @returns A function that inserts a call.
 */
function inserter(database: Database): McpCallRepository['record'] {
  const insert = database.query(
    `INSERT INTO mcp_calls
       (id, at, token_id, token_name, user_id, role, tool, arguments, outcome, duration_ms, address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return (row) => {
    const who = [row.tokenId, row.tokenName, row.userId, row.role];
    const what = [row.tool, row.arguments, row.outcome, row.durationMs, row.address];
    insert.run(row.id, row.at, ...who, ...what);
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createMcpCallRepository(database: Database): McpCallRepository {
  const selectLatest = database.query<StoredCall, [number]>(
    'SELECT * FROM mcp_calls ORDER BY at DESC, id DESC LIMIT ?',
  );
  return {
    record: inserter(database),
    latest: (limit) => selectLatest.all(limit).map(toCall),
    removeBefore: (before) => database.run('DELETE FROM mcp_calls WHERE at < ?', [before]).changes,
  };
}
