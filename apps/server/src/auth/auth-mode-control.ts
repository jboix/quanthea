/**
 * The authentication mode, read on every request so a switch needs no restart. Switching to
 * accounts needs the keys, and an admin who can sign in; the threads started in open access go to
 * an admin. Any switch ends every session. `QUERENT_AUTH_MODE` forces the mode and freezes it.
 */
import type { AuthMode, AuthSettingsView } from '@querent/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ThreadOwnershipRepository } from '../db/thread-ownership.ts';
import type { UserRepository } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { SettingsStore } from '../settings/settings-store.ts';
import type { Sessions } from './sessions.ts';
import type { Users } from './users.ts';

/** The owner of threads started in open access. */
const openAccessOwner = 'anonymous';

/** What the mode control needs. */
export interface AuthModeControlDependencies {
  /** Stores the mode. */
  readonly settings: SettingsStore;
  /** The mode `QUERENT_AUTH_MODE` forces, if set. */
  readonly override: AuthMode | undefined;
  /** What the server lacks for accounts, found at startup. */
  readonly problems: readonly string[];
  /** Stores users, to find the admins who can sign in. */
  readonly users: UserRepository;
  /** Names users. */
  readonly names: Pick<Users, 'nameOf'>;
  /** Hands threads over. */
  readonly threads: ThreadOwnershipRepository;
  /** Ends every session on a switch, when there are sessions. */
  readonly sessions: Pick<Sessions, 'endEvery'> | undefined;
  /** Records who did what. */
  readonly audit: AuditRepository;
}

/** The authentication mode. */
export interface AuthModeControl {
  /**
   * The mode in force.
   *
   * @returns The mode.
   */
  current(): AuthMode;
  /**
   * The settings as an admin sees them.
   *
   * @returns The view.
   */
  view(): Promise<AuthSettingsView>;
  /**
   * Switches the mode.
   *
   * @param mode - The new mode.
   * @param adoptTo - The admin the threads from open access go to, when switching to accounts.
   * @param actor - Who switches.
   * @throws {AppError} `bad_request` when the mode is forced, the keys are missing, no admin can
   *   sign in, or `adoptTo` is not such an admin.
   */
  switchTo(mode: AuthMode, adoptTo: string | undefined, actor: string): void;
  /**
   * Hands the threads from open access to an admin who can sign in.
   *
   * @param userId - The admin.
   * @param actor - Who hands them over.
   * @returns How many threads changed hands.
   * @throws {AppError} `bad_request` when the user is not such an admin.
   */
  adopt(userId: string, actor: string): number;
}

/**
 * The ids of the enabled admins who can sign in.
 *
 * @param users - The users.
 * @returns Their ids, the oldest first.
 */
function signInAdminIds(users: UserRepository): string[] {
  return users
    .list()
    .filter((row) => row.role === 'admin' && row.disabledAt === null && row.passwordHash !== null)
    .map((row) => row.id);
}

/**
 * Checks accounts can start now.
 *
 * @param dependencies - The mode control's dependencies.
 * @param admins - The admins who can sign in.
 * @throws {AppError} `bad_request` naming what is missing.
 */
function checkAccountsReady(dependencies: AuthModeControlDependencies, admins: string[]): void {
  if (dependencies.problems.length > 0)
    throw new AppError('bad_request', dependencies.problems.join(' '));
  if (admins.length === 0)
    throw new AppError(
      'bad_request',
      'Invite an admin in Settings → Users and let them set a password first, so someone can sign in.',
    );
}

/**
 * Hands the threads from open access to an admin who can sign in.
 *
 * @param dependencies - The mode control's dependencies.
 * @param userId - The admin.
 * @param actor - Who hands them over.
 * @returns How many threads changed hands.
 */
function adopt(dependencies: AuthModeControlDependencies, userId: string, actor: string): number {
  if (!signInAdminIds(dependencies.users).includes(userId))
    throw new AppError('bad_request', 'Threads can go only to an admin who can sign in.');
  const adopted = dependencies.threads.handOver(openAccessOwner, userId);
  dependencies.audit.append({
    actor,
    action: 'threads.adopt',
    target: userId,
    detail: { adopted },
  });
  return adopted;
}

/**
 * Switches the mode.
 *
 * @param dependencies - The mode control's dependencies.
 * @param mode - The new mode.
 * @param adoptTo - The admin the threads from open access go to.
 * @param actor - Who switches.
 */
function switchTo(
  dependencies: AuthModeControlDependencies,
  mode: AuthMode,
  adoptTo: string | undefined,
  actor: string,
): void {
  if (dependencies.override !== undefined)
    throw new AppError(
      'bad_request',
      'QUERENT_AUTH_MODE is set on the server. Unset it to change the mode here.',
    );
  if (mode === 'accounts') {
    const admins = signInAdminIds(dependencies.users);
    checkAccountsReady(dependencies, admins);
    const heir = adoptTo ?? admins[0] ?? '';
    if (dependencies.threads.count(openAccessOwner) > 0) adopt(dependencies, heir, actor);
  }
  dependencies.settings.write('auth', { ...dependencies.settings.read('auth'), mode });
  const ended = dependencies.sessions?.endEvery() ?? 0;
  dependencies.audit.append({ actor, action: 'settings.auth-mode', detail: { mode, ended } });
}

/**
 * Creates the mode control.
 *
 * @param dependencies - The settings, the override, the problems, users, threads, sessions and
 *   audit log.
 * @returns The mode control.
 */
export function createAuthModeControl(dependencies: AuthModeControlDependencies): AuthModeControl {
  const current = () => dependencies.override ?? dependencies.settings.read('auth').mode;
  return {
    current,
    view: async () => {
      const ids = signInAdminIds(dependencies.users);
      const signInAdmins = await Promise.all(
        ids.map(async (id) => ({ id, name: (await dependencies.names.nameOf(id)) ?? id })),
      );
      return {
        mode: current(),
        overridden: dependencies.override !== undefined,
        problems: [...dependencies.problems],
        signInAdmins,
        openAccessThreads: dependencies.threads.count(openAccessOwner),
      };
    },
    switchTo: (mode, adoptTo, actor) => switchTo(dependencies, mode, adoptTo, actor),
    adopt: (userId, actor) => adopt(dependencies, userId, actor),
  };
}
