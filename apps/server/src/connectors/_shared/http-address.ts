/**
 * Cloud metadata addresses, which a connector never calls: they hand out the credentials of the
 * machine querent runs on.
 */
import { ConnectorError } from './errors.ts';

/**
 * IPv4 metadata addresses: the link-local range (AWS, Google Cloud, Azure, OpenStack, ECS tasks)
 * and Alibaba Cloud's address.
 */
const metadataIpv4 = [/^169\.254\./, /^100\.100\.100\.200$/];

/** IPv6 metadata addresses: the link-local range and AWS's address. */
const metadataIpv6 = [/^fe[89ab][0-9a-f]:/, /^fd00:ec2::254$/];

/** A dotted IPv4 address. */
const dottedIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The IPv4 address inside an IPv4-mapped IPv6 address, in either notation.
 *
 * @param address - An IPv6 address, lowercase and without brackets.
 * @returns The dotted IPv4 address, or `undefined` when the address is not IPv4-mapped.
 */
function mappedIpv4(address: string): string | undefined {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1] ?? '0', 16);
  const low = Number.parseInt(hex[2] ?? '0', 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/**
 * Whether an address is a cloud metadata address.
 *
 * @param address - An IP address, or a URL host with IPv6 in brackets.
 * @returns `true` for a metadata address, `false` for any other address or a name.
 */
export function isMetadataAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4 = dottedIpv4.test(bare) ? bare : mappedIpv4(bare);
  if (ipv4 !== undefined) return metadataIpv4.some((pattern) => pattern.test(ipv4));
  return metadataIpv6.some((pattern) => pattern.test(bare));
}

/**
 * Whether a URL host is an IP address rather than a name.
 *
 * @param host - The host, as `URL.hostname` gives it.
 * @returns `true` for an IP address.
 */
function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || dottedIpv4.test(host);
}

/**
 * Checks that a URL does not point to a cloud metadata address, by its host and, for a name, by
 * the addresses it resolves to. A name that does not resolve passes: the request then fails as
 * unreachable.
 *
 * @param url - The URL about to be called.
 * @param sourceName - The source, for the message, such as `ClickHouse`.
 * @returns Once the address is checked.
 * @throws {ConnectorError} `rejected` when the host is or resolves to a metadata address.
 */
export async function checkDestination(url: URL, sourceName: string): Promise<void> {
  const refused = new ConnectorError(
    'rejected',
    `The ${sourceName} URL points to a cloud metadata address, which connectors never call.`,
  );
  if (isMetadataAddress(url.hostname)) throw refused;
  if (isIpLiteral(url.hostname)) return;
  const addresses = await Bun.dns.lookup(url.hostname).catch(() => []);
  if (addresses.some((entry) => isMetadataAddress(entry.address))) throw refused;
}
