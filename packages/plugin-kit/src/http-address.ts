/**
 * Cloud metadata addresses, which a connector never calls: they hand out the credentials of the
 * machine quanthea runs on.
 */
import { ConnectorError } from './errors.ts';
import { embeddedIpv4, ipv4Bytes, ipv6Bytes, startsWith } from './ip-bytes.ts';

/**
 * IPv4 metadata addresses: Alibaba Cloud's, Azure's wire server and Oracle Cloud's. The
 * link-local range (AWS, Google Cloud, Azure, OpenStack, ECS tasks) is matched apart.
 */
const metadataIpv4 = [
  [100, 100, 100, 200],
  [168, 63, 129, 16],
  [192, 0, 0, 192],
];

/** IPv6 metadata addresses: AWS's and Google Cloud's. The link-local range is matched apart. */
const metadataIpv6 = [ipv6Bytes('fd00:ec2::254'), ipv6Bytes('fd20:ce::254')];

/**
 * Whether an IPv4 address is a metadata address.
 *
 * @param bytes - Its 4 bytes.
 * @returns `true` for 169.254.0.0/16 or a provider's address.
 */
function isMetadataIpv4(bytes: readonly number[]): boolean {
  if (bytes[0] === 169 && bytes[1] === 254) return true;
  return metadataIpv4.some((address) => startsWith(bytes, address));
}

/**
 * Whether an IPv6 address is a metadata address, or carries an IPv4 one.
 *
 * @param bytes - Its 16 bytes.
 * @returns `true` for fe80::/10, a provider's address, or an embedded IPv4 metadata address.
 */
function isMetadataIpv6(bytes: readonly number[]): boolean {
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true;
  if (metadataIpv6.some((address) => address !== undefined && startsWith(bytes, address)))
    return true;
  return embeddedIpv4(bytes).some(isMetadataIpv4);
}

/**
 * Whether an address is a cloud metadata address. An IPv6 address is read as bytes, so every
 * spelling matches, and an IPv4 address inside it (compatible, mapped, translated, NAT64, 6to4)
 * is checked as IPv4.
 *
 * @param address - An IP address, or a URL host with IPv6 in brackets.
 * @returns `true` for a metadata address, `false` for any other address or a name.
 */
export function isMetadataAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '');
  const ipv4 = ipv4Bytes(bare);
  if (ipv4) return isMetadataIpv4(ipv4);
  const ipv6 = ipv6Bytes(bare);
  return ipv6 !== undefined && isMetadataIpv6(ipv6);
}

/**
 * Whether a URL host is an IP address rather than a name.
 *
 * @param host - The host, as `URL.hostname` gives it.
 * @returns `true` for an IP address.
 */
function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || ipv4Bytes(host) !== undefined;
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
    `The ${sourceName} URL points to a cloud metadata address, which quanthea never calls.`,
  );
  if (isMetadataAddress(url.hostname)) throw refused;
  if (isIpLiteral(url.hostname)) return;
  const addresses = await Bun.dns.lookup(url.hostname).catch(() => []);
  if (addresses.some((entry) => isMetadataAddress(entry.address))) throw refused;
}
