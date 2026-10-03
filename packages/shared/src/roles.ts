/** Roles and the principal a request acts as. */
import { z } from 'zod';

/**
 * The four roles, weakest first. The order is the privilege order: viewers read pinned
 * dashboards, analysts also ask questions about them, editors build them, admins run quanthea.
 */
export const roles = ['viewer', 'analyst', 'editor', 'admin'] as const;

/** Validates a role name. */
export const roleSchema = z.enum(roles);

/** A role name. */
export type Role = z.infer<typeof roleSchema>;

/** Validates the identity and role a request acts as. */
export const principalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: roleSchema,
  /** The default admin before they choose their own email and password; nothing else is open. */
  setupRequired: z.boolean().optional(),
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
