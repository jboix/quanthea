/** Users, for admins: invite, change the role, disable, make a reset link, end sessions. */
import { z } from 'zod';
import { roleSchema } from '../roles.ts';
import { defineEndpoint } from './contract.ts';

/** Validates a user as an admin sees them. */
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  disabled: z.boolean(),
  hasPassword: z.boolean(),
  lastSignInAt: z.number().nullable(),
  createdAt: z.number(),
  /** The configuration file that manages them, when one does; their role and state are its. */
  managedBy: z.string().optional(),
});

/** A user as an admin sees them. */
export type UserView = z.infer<typeof userSchema>;

/** A link that sets a password, to hand to its person; the token is after the `#`. */
export const passwordLinkSchema = z.object({ link: z.string(), expiresAt: z.number() });

/** The path parameter of one user. */
const userParams = z.object({ userId: z.string().min(1) });

/** Lists the users. */
export const listUsersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/users',
  output: z.object({ users: z.array(userSchema) }),
});

/** Creates a user and an invite link that sets their password. */
export const inviteUserEndpoint = defineEndpoint({
  method: 'POST',
  path: '/users',
  body: z.object({
    email: z.email().max(320),
    name: z.string().trim().min(1).max(100),
    role: roleSchema,
  }),
  output: z.object({ user: userSchema, invite: passwordLinkSchema }),
});

/** Changes a user's role, or whether they may sign in. */
export const updateUserEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/users/:userId',
  params: userParams,
  body: z.object({ role: roleSchema.optional(), disabled: z.boolean().optional() }),
  output: userSchema,
});

/** Makes a reset link for a user; it replaces their earlier links. */
export const resetLinkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/users/:userId/reset-link',
  params: userParams,
  output: passwordLinkSchema,
});

/** Ends every session of a user. */
export const endUserSessionsEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/users/:userId/sessions',
  params: userParams,
  output: z.object({ ended: z.int() }),
});
