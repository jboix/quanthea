/** The usage report, for admins: what the model steps spent, by hour, model and user. */
import { type Role, usageReportEndpoint } from '@querent/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { Usage } from '../../usage/usage.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/** Who owned the threads started while everyone was an anonymous admin, before accounts. */
const openAccessOwner = 'anonymous';

/**
 * The name and role of each user a report names.
 *
 * @param users - The users.
 * @param ids - The users the report names.
 * @returns Each one's name and role, by id.
 */
async function peopleOf(
  users: Pick<Users, 'list'>,
  ids: ReadonlySet<string>,
): Promise<Record<string, { name: string; role: Role | null }>> {
  const known = new Map((await users.list()).map((user) => [user.id, user]));
  const people: Record<string, { name: string; role: Role | null }> = {};
  for (const id of ids) {
    const user = known.get(id);
    if (user) people[id] = { name: user.name, role: user.role };
    else
      people[id] = { name: id === openAccessOwner ? 'Open access' : 'A removed user', role: null };
  }
  return people;
}

/**
 * Mounts `GET /api/settings/usage`, for admins.
 *
 * @param app - The app.
 * @param services - The usage ledger and the users.
 * @param services.usage - The usage ledger.
 * @param services.users - The users, for names.
 */
export function mountUsageEndpoints(
  app: Hono<AppEnv>,
  services: { readonly usage: Usage; readonly users: Pick<Users, 'list'> },
): void {
  mountEndpoint(app, usageReportEndpoint, {
    access: 'admin',
    handle: async ({ query }) => {
      const report = services.usage.report(query.days);
      const ids = new Set(report.buckets.map((bucket) => bucket.userId).filter(Boolean));
      return { ...report, people: await peopleOf(services.users, ids) };
    },
  });
}
