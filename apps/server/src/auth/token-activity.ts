/**
 * What API tokens did: every tool call on the MCP endpoint is written down with the token, its
 * owner, the tool, its arguments, how it ended and where it came from. An admin reads the latest;
 * a call is kept 90 days. The arguments are what the caller sent, never a result.
 */
import type { McpCallOutcome, McpCallView, Role } from '@quanthea/shared';
import type { McpCallRepository } from '../db/mcp-call-repository.ts';
import { newId } from '../lib/ids.ts';
import type { TokenIdentity } from './token-sign-in.ts';
import type { Users } from './users.ts';

/** How long a call is kept. */
const keptMs = 90 * 86_400_000;

/** The longest arguments kept, in characters. */
const argumentsLimit = 2000;

/** How many calls an admin reads at once. */
const listed = 200;

/** A tool call to write down. */
export interface TokenCall {
  /** The token it came with. */
  readonly token: TokenIdentity;
  /** The token's owner. */
  readonly userId: string;
  /** The role the call acted with. */
  readonly role: Role;
  /** The tool, as the caller named it. */
  readonly tool: string;
  /** The arguments the caller sent. */
  readonly input: unknown;
  /** How the call ended. */
  readonly outcome: McpCallOutcome;
  /** How long it took. */
  readonly durationMs: number;
  /** Where the request came from. */
  readonly address: string;
}

/** The record of what tokens did. */
export interface TokenActivity {
  /**
   * Writes a call down.
   *
   * @param call - The call.
   */
  record(call: TokenCall): void;
  /**
   * The latest calls, with their owners' names.
   *
   * @returns At most 200 calls, the newest first.
   */
  latest(): Promise<McpCallView[]>;
  /**
   * Deletes the calls older than 90 days.
   *
   * @returns How many were deleted.
   */
  purgeOld(): number;
}

/** What the record needs. */
export interface TokenActivityDependencies {
  /** Stores the calls. */
  readonly repository: McpCallRepository;
  /** Names the owners. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/**
 * Arguments as kept: JSON, cut when long.
 *
 * @param input - What the caller sent.
 * @returns The text.
 */
function argumentsText(input: unknown): string {
  const text = JSON.stringify(input ?? {}) ?? '{}';
  return text.length > argumentsLimit ? `${text.slice(0, argumentsLimit)}…` : text;
}

/**
 * The names of the owners of some calls.
 *
 * @param users - Names a user.
 * @param userIds - The owners.
 * @returns Each owner's name, `null` for one who is gone.
 */
async function namesOf(
  users: Pick<Users, 'nameOf'>,
  userIds: readonly string[],
): Promise<Map<string, string | null>> {
  const distinct = [...new Set(userIds)];
  const names = await Promise.all(distinct.map((id) => users.nameOf(id)));
  return new Map(distinct.map((id, index) => [id, names[index] ?? null]));
}

/**
 * Creates the record of what tokens did.
 *
 * @param dependencies - The repository, the users and the clock.
 * @returns The record.
 */
export function createTokenActivity(dependencies: TokenActivityDependencies): TokenActivity {
  const { repository, users } = dependencies;
  const now = dependencies.now ?? Date.now;
  return {
    record({ token, input, ...call }) {
      const named = { tokenId: token.id, tokenName: token.name, ...call };
      repository.record({ id: newId(), at: now(), ...named, arguments: argumentsText(input) });
    },
    async latest() {
      const calls = repository.latest(listed);
      const names = await namesOf(
        users,
        calls.map((call) => call.userId),
      );
      return calls.map((call) => ({ ...call, userName: names.get(call.userId) ?? null }));
    },
    purgeOld: () => repository.removeBefore(now() - keptMs),
  };
}
