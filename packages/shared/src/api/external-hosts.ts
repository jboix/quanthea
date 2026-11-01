/**
 * The external hosts: where dashboards may link and load images from. Links go to any host until
 * an admin narrows them to the hosts listed. Images load only from listed hosts marked for images,
 * since an image loads when the dashboard opens and so tells its host who looked.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/**
 * A host name as a browser reads it: lowercase letters, digits, dots and dashes, with at least
 * one letter. No scheme, path, port, user or IP literal.
 */
export const hostNameSchema = z
  .string()
  .max(253)
  .regex(
    /^(?=[^.]*[a-z]|.*\.[^.]*[a-z])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
    'A host is a name such as media.example.com: lowercase letters, digits, dots and dashes, with no scheme, path, port or IP address.',
  );

/** The most hosts the list holds. */
export const maxExternalHosts = 50;

/** Validates one listed host. */
const externalHostSchema = z.strictObject({
  host: hostNameSchema,
  /** Whether images may load from it too. */
  images: z.boolean().default(false),
});

/** Validates the external hosts. */
export const externalHostsSchema = z.strictObject({
  /** Whether links may go to any host; `false` keeps them to the hosts listed. */
  linksToAnyHost: z.boolean().default(true),
  hosts: z.array(externalHostSchema).max(maxExternalHosts).default([]),
});

/** The external hosts. */
export type ExternalHosts = z.infer<typeof externalHostsSchema>;

/** The external hosts before an admin saves any: links anywhere, images from nowhere. */
export const defaultExternalHosts: ExternalHosts = { linksToAnyHost: true, hosts: [] };

/**
 * Whether a link may go to a host.
 *
 * @param settings - The external hosts.
 * @param host - The host of the link.
 * @returns `true` when links go to any host, or the host is listed.
 */
export function linkHostAllowed(settings: ExternalHosts, host: string): boolean {
  return settings.linksToAnyHost || settings.hosts.some((each) => each.host === host);
}

/**
 * Whether an image may load from a host.
 *
 * @param settings - The external hosts.
 * @param host - The host of the image.
 * @returns `true` when the host is listed for images.
 */
export function imageHostAllowed(settings: ExternalHosts, host: string): boolean {
  return settings.hosts.some((each) => each.host === host && each.images);
}

/** The external hosts, for every signed-in person, since the browser draws links and images. */
export const readExternalHostsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/external-hosts',
  output: externalHostsSchema,
});

/** The external hosts, for admins, on the settings screen. */
export const getExternalHostsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/external-hosts',
  output: externalHostsSchema,
});

/** Saves the external hosts, for admins. */
export const saveExternalHostsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/external-hosts',
  body: externalHostsSchema,
  output: externalHostsSchema,
});
