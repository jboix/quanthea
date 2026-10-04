/**
 * The endpoints of the bin of conversations about dashboards. Analysts and above move the
 * conversations they started to the bin, list the ones they started or binned, and restore them;
 * admins do so for every conversation, and delete them for good.
 */
import {
  binConversationEndpoint,
  listBinnedConversationsEndpoint,
  type Principal,
  purgeConversationEndpoint,
  restoreConversationEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { ConversationBin } from '../../dashboards/conversation-bin.ts';
import type { RetentionSettingsService } from '../../settings/retention-settings.ts';
import type { ThreadOwner } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { ownerNames, roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the endpoints of the bin of conversations need. */
export interface ConversationBinRouteServices {
  /** The bin of conversations. */
  readonly conversationBin: ConversationBin;
  /** The retention settings, for how long the bin keeps them. */
  readonly retention: Pick<RetentionSettingsService, 'get'>;
  /** The users, for the starters' names and who binned. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf: (dashboardId: string) => ThreadOwner | null;
}

/**
 * The binned conversations someone may restore, each naming its starter and who binned it.
 *
 * @param services - The bin of conversations and the users.
 * @param principal - Who asks.
 * @returns The conversations.
 */
function binnedFor(services: ConversationBinRouteServices, principal: Principal) {
  const nameOf = ownerNames(services.users);
  return Promise.all(
    services.conversationBin.list(principal).map(async (binned) => ({
      ...binned,
      startedBy: await nameOf(binned.startedBy),
      binnedBy: await nameOf(binned.binnedBy),
    })),
  );
}

/**
 * Mounts the endpoints of the bin of conversations.
 *
 * @param app - The app.
 * @param services - The bin of conversations, the retention, the users and a dashboard's owner.
 */
export function mountConversationBinEndpoints(
  app: Hono<AppEnv>,
  services: ConversationBinRouteServices,
): void {
  const { conversationBin } = services;
  mountEndpoint(app, binConversationEndpoint, {
    access: 'analyst',
    handle: ({ params: { dashboardId, conversationId }, principal }) => {
      const actor = signedIn(principal);
      const role = roleForDashboard(actor, services.ownerOf(dashboardId));
      conversationBin.bin({ dashboardId, conversationId }, actor, role);
      return { binned: true as const };
    },
  });
  mountEndpoint(app, listBinnedConversationsEndpoint, {
    access: 'analyst',
    handle: async ({ principal }) => ({
      conversations: await binnedFor(services, signedIn(principal)),
      binDays: services.retention.get().binDays,
    }),
  });
  mountEndpoint(app, restoreConversationEndpoint, {
    access: 'analyst',
    handle: ({ params, principal }) => {
      conversationBin.restore(params.conversationId, signedIn(principal));
      return { restored: true as const };
    },
  });
  mountEndpoint(app, purgeConversationEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => {
      conversationBin.purge(params.conversationId, actorOf(principal));
      return { purged: true as const };
    },
  });
}
