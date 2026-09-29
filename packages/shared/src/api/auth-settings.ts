/** Settings → Authentication: the mode, what switching needs, and threads from open access. */
import { z } from 'zod';
import { authModeSchema } from '../roles.ts';
import { defineEndpoint } from './contract.ts';

/** Validates the authentication settings as an admin sees them. */
export const authSettingsSchema = z.object({
  mode: authModeSchema,
  /** Whether `QUERENT_AUTH_MODE` forces the mode on the server; the mode cannot change here then. */
  overridden: z.boolean(),
  /** What the server lacks for accounts: keys or the public URL. None when accounts can start. */
  problems: z.array(z.string()),
  /** The enabled admins who can sign in, one of whom must exist to switch to accounts. */
  signInAdmins: z.array(z.object({ id: z.string(), name: z.string() })),
  /** How many threads were started in open access, and belong to no one yet. */
  openAccessThreads: z.int(),
});

/** The authentication settings as an admin sees them. */
export type AuthSettingsView = z.infer<typeof authSettingsSchema>;

/** The authentication settings, for admins. */
export const getAuthSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/auth',
  output: authSettingsSchema,
});

/**
 * Switches the mode, and ends every session. Switching to accounts hands the threads from open
 * access to `adoptTo`, an admin who can sign in.
 */
export const saveAuthSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/auth',
  body: z.object({ mode: authModeSchema, adoptTo: z.string().min(1).optional() }),
  output: authSettingsSchema,
});

/** Hands the threads from open access to an admin who can sign in. */
export const adoptThreadsEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/auth/adopt',
  body: z.object({ userId: z.string().min(1) }),
  output: z.object({ adopted: z.int() }),
});
