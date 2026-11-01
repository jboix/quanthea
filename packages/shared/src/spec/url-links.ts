/**
 * Links from a table column or a stat to a page outside quanthea: an https address with at most
 * one `{value}`, which takes the cell's value, a column of the row or a chosen variable, encoded.
 * The browser draws one only when an admin allowed its host, and opens it in a new tab.
 */
import { z } from 'zod';
import { hostNameSchema } from '../api/external-hosts.ts';
import { variableNameSchema } from './names.ts';

/** What a link's address holds where the value goes. */
export const urlPlaceholder = '{value}';

/** The longest address a link may hold. */
const maxUrlLength = 500;

/** What a link's address must be, as a refusal says it. */
const urlShape = 'A link URL is an https address such as https://example.com/items/{value}.';

/** An absolute address: its scheme, its host part, and the rest, with no space or backslash. */
const addressPattern = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s\\]*)([/?#][^\s\\]*)?$/i;

/** An address split in its parts. */
interface AddressParts {
  /** Its scheme, such as `https`. */
  readonly scheme: string;
  /** Its host part, user and port included when written. */
  readonly authority: string;
}

/**
 * The parts of an address.
 *
 * @param text - The address.
 * @returns Its parts, or `undefined` when it is not an absolute address.
 */
function addressParts(text: string): AddressParts | undefined {
  const match = addressPattern.exec(text);
  if (!match) return undefined;
  return { scheme: (match[1] ?? '').toLowerCase(), authority: match[2] ?? '' };
}

/**
 * The problem with where an address leads, if any.
 *
 * @param parts - The address's parts.
 * @returns The message, or `undefined`.
 */
function hostProblem(parts: AddressParts): string | undefined {
  const { scheme, authority } = parts;
  if (scheme !== 'https') return 'A link URL starts with https://.';
  if (authority.includes(urlPlaceholder))
    return 'A link URL holds {value} in its path or query, not its host.';
  if (authority.includes('@')) return 'A link URL holds no user or password.';
  if (authority.includes(':')) return 'A link URL holds no port.';
  if (!hostNameSchema.safeParse(authority).success)
    return 'A link URL names its host in lowercase, such as example.com, not an IP address.';
  return undefined;
}

/**
 * The problem with a link's address, if any.
 *
 * @param text - The address as written.
 * @returns The message, or `undefined`.
 */
function urlProblem(text: string): string | undefined {
  if (text.split(urlPlaceholder).length > 2) return 'A link URL holds {value} once at most.';
  const parts = addressParts(text);
  if (parts) return hostProblem(parts);
  return text.toLowerCase().startsWith('https://') ? urlShape : 'A link URL starts with https://.';
}

/** Validates a link's address. */
const urlTemplateSchema = z
  .string()
  .max(maxUrlLength)
  .superRefine((text, context) => {
    const message = urlProblem(text);
    if (message) context.addIssue({ code: 'custom', message });
  });

/** Validates a link to an address outside quanthea. */
export const urlLinkSchema = z.strictObject({
  url: urlTemplateSchema,
  /** Where `{value}` comes from; a table's cell by default. */
  value: z
    .union([
      z.strictObject({ column: z.string().min(1).max(200) }),
      z.strictObject({ variable: variableNameSchema }),
    ])
    .optional(),
});

/** A link to an address outside quanthea. */
export type UrlLink = z.infer<typeof urlLinkSchema>;

/** The longest address an image cell shows. */
const maxImageAddressLength = 2000;

/**
 * The host of a value that is an https address on a named host, with no user or port: the only
 * values an image cell shows.
 *
 * @param value - A cell's value.
 * @returns The host, or `undefined` when the value is not such an address.
 */
export function httpsHostOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > maxImageAddressLength) return undefined;
  const parts = addressParts(value);
  if (parts?.scheme !== 'https') return undefined;
  return hostNameSchema.safeParse(parts.authority).success ? parts.authority : undefined;
}

/**
 * The host a link leads to.
 *
 * @param link - The link.
 * @returns Its host name, such as `example.com`.
 */
export function urlLinkHost(link: UrlLink): string {
  return addressParts(link.url)?.authority ?? '';
}

/**
 * The address a link opens, its value encoded. A value of `.` or `..` would move up the address's
 * path, so it draws no link, and neither does a missing or empty one.
 *
 * @param link - The link.
 * @param value - The value, if any.
 * @returns The address, or `undefined` to draw the value as text.
 */
export function urlLinkAddress(link: UrlLink, value: string | undefined): string | undefined {
  if (!link.url.includes(urlPlaceholder)) return link.url;
  if (value === undefined || value === '' || value === '.' || value === '..') return undefined;
  return link.url.split(urlPlaceholder).join(encodeURIComponent(value));
}
