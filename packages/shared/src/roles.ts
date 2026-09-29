/** Roles and the principal a request acts as. */
import { z } from 'zod';

/** The three roles, weakest first. The order is the privilege order. */
export const roles = ['viewer', 'editor', 'admin'] as const;

/** Validates a role name. */
export const roleSchema = z.enum(roles);

/** A role name. */
export type Role = z.infer<typeof roleSchema>;

/**
 * Validates the authentication mode chosen in Settings, or forced by `QUERENT_AUTH_MODE`: `none`
 * makes everyone an admin; `accounts` signs people in, by password or through a provider.
 */
export const authModeSchema = z.enum(['none', 'accounts']);

/** How users authenticate: `none` makes everyone an admin. */
export type AuthMode = z.infer<typeof authModeSchema>;

/** Validates the identity and role a request acts as. */
export const principalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: roleSchema,
});

/** The identity and role a request acts as. Recorded on audit events, never used as ownership. */
export type Principal = z.infer<typeof principalSchema>;

/**
 * Whether a role grants at least the privileges of another.
 *
 * @param actual - The role the principal holds.
 * @param minimum - The weakest role that is allowed.
 * @returns `true` when `actual` is `minimum` or stronger.
 */
export function hasRole(actual: Role, minimum: Role): boolean {
  return roles.indexOf(actual) >= roles.indexOf(minimum);
}
