/**
 * The external hosts: where dashboards may link to, and where they may load images from, each any
 * host or only the hosts listed. Links go to any host and images load from none until an admin
 * says otherwise, since an image loads when the dashboard opens and so tells its host who looked.
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

/** Validates where one kind of reach may go: any host, or only the hosts listed. */
const reachSchema = z.strictObject({
  /** Whether any host is allowed; `false` keeps to the hosts listed. */
  anyHost: z.boolean(),
  hosts: z.array(hostNameSchema).max(maxExternalHosts).default([]),
});

/** Where one kind of reach may go: any host, or only the hosts listed. */
export type Reach = z.infer<typeof reachSchema>;

/** The settings as saved before links and images had a list each: one list, a flag for images. */
const oneListSchema = z.object({
  linksToAnyHost: z.boolean().default(true),
  hosts: z.array(z.object({ host: z.string(), images: z.boolean().default(false) })).default([]),
});

/**
 * Reads settings saved as one list into a list each: every listed host for links, the ones
 * flagged for images for images, which stay off any host.
 *
 * @param value - The stored value.
 * @returns The value in the shape of a list each, or the value as it was.
 */
function fromOneList(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || 'links' in value) return value;
  const old = oneListSchema.safeParse(value);
  if (!old.success) return value;
  const { linksToAnyHost, hosts } = old.data;
  return {
    links: { anyHost: linksToAnyHost, hosts: hosts.map((each) => each.host) },
    images: { anyHost: false, hosts: hosts.filter((each) => each.images).map((each) => each.host) },
  };
}

/** Validates the external hosts: where links may go, and where images may load from. */
export const externalHostsSchema = z.preprocess(
  fromOneList,
  z.strictObject({
    links: reachSchema,
    images: reachSchema,
  }),
);

/** The external hosts. */
export type ExternalHosts = z.infer<typeof externalHostsSchema>;

/** The external hosts before an admin saves any: links anywhere, images from nowhere. */
export const defaultExternalHosts: ExternalHosts = {
  links: { anyHost: true, hosts: [] },
  images: { anyHost: false, hosts: [] },
};

/**
 * Whether a link may go to a host.
 *
 * @param settings - The external hosts.
 * @param host - The host of the link.
 * @returns `true` when links go to any host, or the host is listed for links.
 */
export function linkHostAllowed(settings: ExternalHosts, host: string): boolean {
  return settings.links.anyHost || settings.links.hosts.includes(host);
}

/**
 * Whether an image may load from a host.
 *
 * @param settings - The external hosts.
 * @param host - The host of the image.
 * @returns `true` when images load from any host, or the host is listed for images.
 */
export function imageHostAllowed(settings: ExternalHosts, host: string): boolean {
  return settings.images.anyHost || settings.images.hosts.includes(host);
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
