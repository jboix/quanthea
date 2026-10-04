/**
 * The notification channel endpoints. Admins add, change, delete and test channels and read their
 * log, since a message leaves quanthea when it is sent; editors list channels by name and kind for
 * an alert, and preview what each kind would send.
 */
import {
  createChannelEndpoint,
  deleteChannelEndpoint,
  listChannelSendsEndpoint,
  listChannelsEndpoint,
  pickChannelsEndpoint,
  previewNotificationEndpoint,
  testChannelEndpoint,
  updateChannelEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { ChannelInfo } from '../../notifications/channel-store.ts';
import type { Notifications } from '../../notifications/notifications.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { ownerNames } from '../ownership.ts';
import { actorOf } from '../principal.ts';

/** What the notification endpoints need. */
export interface NotificationRouteServices {
  /** The notification channels. */
  readonly notifications: Notifications;
  /** The users, for the names of who added each channel. */
  readonly users: Pick<Users, 'nameOf'>;
}

/**
 * Names the admins who added channels, looking each up once per request.
 *
 * @param users - The users.
 * @returns A function that replaces a channel's creator id with their name.
 */
function namer(users: Pick<Users, 'nameOf'>) {
  const nameOf = ownerNames(users);
  return async ({ createdById, ...channel }: ChannelInfo) => ({
    ...channel,
    createdBy: await nameOf(createdById),
  });
}

/**
 * Mounts the admin endpoints that read and change channels.
 *
 * @param app - The app.
 * @param services - The notifications and the users.
 */
function mountChannelEndpoints(app: Hono<AppEnv>, services: NotificationRouteServices): void {
  const { notifications, users } = services;
  mountEndpoint(app, listChannelsEndpoint, {
    access: 'admin',
    handle: async () => ({ channels: await Promise.all(notifications.list().map(namer(users))) }),
  });
  mountEndpoint(app, createChannelEndpoint, {
    access: 'admin',
    handle: async ({ body, principal }) =>
      namer(users)(await notifications.create(body, actorOf(principal))),
  });
  mountEndpoint(app, updateChannelEndpoint, {
    access: 'admin',
    handle: async ({ params, body, principal }) =>
      namer(users)(await notifications.update(params.channelId, body, actorOf(principal))),
  });
  mountEndpoint(app, deleteChannelEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => {
      notifications.remove(params.channelId, actorOf(principal));
      return { deleted: true as const };
    },
  });
}

/**
 * Mounts the notification endpoints.
 *
 * @param app - The app.
 * @param services - The notifications and the users.
 */
export function mountNotificationEndpoints(
  app: Hono<AppEnv>,
  services: NotificationRouteServices,
): void {
  const { notifications } = services;
  mountChannelEndpoints(app, services);
  mountEndpoint(app, testChannelEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => notifications.test(params.channelId, actorOf(principal)),
  });
  mountEndpoint(app, listChannelSendsEndpoint, {
    access: 'admin',
    handle: ({ params }) => ({ sends: notifications.sends(params.channelId) }),
  });
  mountEndpoint(app, pickChannelsEndpoint, {
    access: 'editor',
    handle: () => ({ channels: notifications.picker() }),
  });
  mountEndpoint(app, previewNotificationEndpoint, {
    access: 'editor',
    handle: ({ body }) => ({ previews: notifications.preview(body) }),
  });
}
