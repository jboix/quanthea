/**
 * Where a plugin comes from, as `quanthea plugin install` is given it: an npm package name with an
 * optional version or range, an `https://` tarball URL such as a GitHub release asset, a local
 * `.tgz`, or a local `.js` bundle inside its package folder. Each gives the plugin's two files, the
 * manifest and the bundle, read from the tarball and nothing else. Every fetch is over HTTPS,
 * redirects included.
 */
import { dirname, join, resolve } from 'node:path';
import { pluginNameSchema } from '../config/config.ts';
import { readManifest } from './manifest.ts';
import { ArchiveError, gunzip, readTar } from './tar.ts';

/** The default npm registry. */
export const defaultRegistry = 'https://registry.npmjs.org';

/** How large a tarball may be, compressed. */
const maxCompressed = 32 * 1024 * 1024;

/** How large a tarball may be, once uncompressed. */
const maxUncompressed = 128 * 1024 * 1024;

/** How large a manifest may be. */
const maxManifest = 1024 * 1024;

/** How many redirects a fetch follows. */
const maxRedirects = 5;

/** The statuses that redirect. */
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/** What fetching needs. */
export interface SourceOptions {
  /** The npm registry. */
  readonly registry: string;
  /** The largest bundle accepted, in bytes. */
  readonly maxBundleBytes: number;
  /** The working directory, for local paths. */
  readonly workingDir: string;
  /** The fetch function, replaced in tests. */
  readonly fetch: typeof fetch;
  /** The integrity an `https://` tarball URL must match, such as `sha512-…`, when given. */
  readonly integrity?: string;
}

/** A plugin's two files, as found. */
export interface PluginFiles {
  /** The manifest bytes. */
  readonly manifest: Uint8Array;
  /** The bundle bytes. */
  readonly bundle: Uint8Array;
  /** Where they came from, in words. */
  readonly origin: string;
  /** The package name asked for, when the spec named one. */
  readonly requested?: string;
}

/** Why a plugin cannot be fetched. */
export class SourceError extends Error {}

/**
 * Reads a response body up to a size.
 *
 * @param response - The response.
 * @param maxBytes - The most bytes accepted.
 * @param what - What it is, for the message.
 * @returns The bytes.
 * @throws {SourceError} When it is larger.
 */
async function limitedBody(response: Response, maxBytes: number, what: string) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new SourceError(`${what} is larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Where a response redirects to, if it does.
 *
 * @param response - The response.
 * @param url - The URL it answered, which a relative location resolves against.
 * @returns The absolute URL, or `undefined` when it does not redirect.
 */
function redirectOf(response: Response, url: string): string | undefined {
  const location = response.headers.get('Location');
  if (!redirectStatuses.has(response.status) || location === null) return undefined;
  return new URL(location, url).href;
}

/**
 * Fetches over HTTPS, following a few redirects, each to an `https://` URL.
 *
 * @param url - The URL.
 * @param options - The fetch function.
 * @param accept - The Accept header.
 * @returns The response.
 * @throws {SourceError} For a URL or a redirect that is not HTTPS, too many redirects, or a
 *   failed request.
 */
async function getHttps(url: string, options: SourceOptions, accept: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!current.startsWith('https://'))
      throw new SourceError(`only https:// is fetched: ${current}`);
    const init = { headers: { Accept: accept }, redirect: 'manual' } as const;
    const response = await options.fetch(current, init);
    const next = redirectOf(response, current);
    if (next === undefined) {
      if (!response.ok) throw new SourceError(`${current} answered ${response.status}`);
      return response;
    }
    await response.body?.cancel();
    current = next;
  }
  throw new SourceError(`${url} redirects more than ${maxRedirects} times`);
}

/**
 * The manifest and the bundle of a tarball, the bundle being the file the manifest names.
 *
 * @param tgz - The tarball.
 * @param origin - Where it came from.
 * @returns The two files.
 * @throws {SourceError} For an unsafe or incomplete archive, or a manifest that cannot be read.
 */
export function filesOfTarball(tgz: Uint8Array, origin: string): PluginFiles {
  try {
    const tar = gunzip(tgz, maxUncompressed);
    const manifest = readTar(tar, new Set(['package/package.json'])).get('package/package.json');
    if (!manifest) throw new SourceError('the archive has no package/package.json');
    if (manifest.length > maxManifest) throw new SourceError('package.json is too large');
    const read = readManifest(new TextDecoder().decode(manifest));
    if ('problem' in read) throw new SourceError(read.problem);
    const path = `package/${read.manifest.quanthea.main}`;
    const bundle = readTar(tar, new Set([path])).get(path);
    if (!bundle) throw new SourceError(`the archive has no ${path}, which package.json names`);
    return { manifest, bundle, origin };
  } catch (error) {
    if (error instanceof ArchiveError) throw new SourceError(error.message);
    throw error;
  }
}

/**
 * A local `.js` bundle and the manifest of the package folder that names it as its `main`.
 *
 * @param path - The bundle's path.
 * @returns The two files.
 * @throws {SourceError} When no package folder above it names it.
 */
async function localBundle(path: string): Promise<PluginFiles> {
  for (let folder = dirname(path), up = 0; up < 6; folder = dirname(folder), up += 1) {
    const file = Bun.file(join(folder, 'package.json'));
    if (!(await file.exists())) continue;
    const manifest = new Uint8Array(await file.arrayBuffer());
    const read = readManifest(new TextDecoder().decode(manifest));
    if ('problem' in read || resolve(folder, read.manifest.quanthea.main) !== path) continue;
    return { manifest, bundle: new Uint8Array(await Bun.file(path).arrayBuffer()), origin: path };
  }
  throw new SourceError(`no package.json above ${path} names it as quanthea.main`);
}

/**
 * A package spec split into a name and a version or range.
 *
 * @param spec - Such as `quanthea-plugin-sqlite@^1.2.0` or `@acme/quanthea-plugin-x`.
 * @returns The name and the range, if any.
 * @throws {SourceError} When the name is not a plugin's.
 */
export function parsePackageSpec(spec: string): { name: string; range: string | undefined } {
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  const range = at > 0 ? spec.slice(at + 1) : undefined;
  if (!pluginNameSchema.safeParse(name).success)
    throw new SourceError(
      `"${name}" is not a plugin package: quanthea-plugin-<name> or @scope/quanthea-plugin-<name>`,
    );
  return { name, range: range === '' ? undefined : range };
}

/** A version of a package in the registry. */
interface RegistryVersion {
  /** Its tarball and the tarball's integrity. */
  readonly dist?: { readonly tarball?: string; readonly integrity?: string };
}

/** A package as the registry describes it. */
interface RegistryPackage {
  /** The tags, `latest` among them. */
  readonly 'dist-tags'?: Readonly<Record<string, string>>;
  /** The versions. */
  readonly versions?: Readonly<Record<string, RegistryVersion>>;
}

/**
 * The version a range resolves to: the latest tag without one, else the highest version that
 * satisfies it.
 *
 * @param metadata - The package's metadata.
 * @param range - The version or range, if any.
 * @returns The version.
 * @throws {SourceError} When none satisfies it.
 */
export function resolveVersion(metadata: RegistryPackage, range: string | undefined): string {
  const versions = Object.keys(metadata.versions ?? {});
  const tagged =
    range === undefined ? metadata['dist-tags']?.latest : metadata['dist-tags']?.[range];
  if (tagged !== undefined && versions.includes(tagged)) return tagged;
  const matching = versions
    .filter((version) => Bun.semver.satisfies(version, range ?? '*'))
    .sort((left, right) => Bun.semver.order(right, left));
  const [highest] = matching;
  if (highest === undefined) throw new SourceError(`no version satisfies ${range ?? 'latest'}`);
  return highest;
}

/**
 * Checks a tarball against an integrity hash (SHA-512).
 *
 * @param tgz - The tarball.
 * @param integrity - The integrity, such as `sha512-…`.
 * @param giver - Who gives it, for the message: `the registry` or `--integrity`.
 * @throws {SourceError} Without a SHA-512 hash, or when it does not match.
 */
function checkIntegrity(tgz: Uint8Array, integrity: string | undefined, giver: string): void {
  const expected = integrity
    ?.split(/\s+/)
    .find((hash) => hash.startsWith('sha512-'))
    ?.slice('sha512-'.length);
  if (!expected) throw new SourceError(`${giver} gives no sha512 integrity for the tarball`);
  if (new Bun.CryptoHasher('sha512').update(tgz).digest('base64') !== expected)
    throw new SourceError(`the tarball does not match the integrity ${giver} gives`);
}

/**
 * Where provenance would be checked: the version's signed build attestation, such as one
 * `npm publish --provenance` attaches. Not checked yet.
 *
 * @param _name - The package name.
 * @param _version - The version.
 * @returns Once checked.
 */
async function checkProvenance(_name: string, _version: string): Promise<void> {
  // EXTENSION POINT: verify the npm provenance attestation of this version here.
}

/**
 * A package's two files from the npm registry, the tarball checked against its integrity.
 *
 * @param spec - The package spec.
 * @param options - The registry and the fetch function.
 * @returns The two files, with the version installed.
 * @throws {SourceError} When the package, the version or a matching tarball cannot be found.
 */
async function fromRegistry(spec: string, options: SourceOptions): Promise<PluginFiles> {
  const { name, range } = parsePackageSpec(spec);
  const registry = options.registry.replace(/\/+$/, '');
  const accept = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8';
  const response = await getHttps(`${registry}/${name.replaceAll('/', '%2f')}`, options, accept);
  const metadata = (await response.json()) as RegistryPackage;
  const version = resolveVersion(metadata, range);
  const dist = metadata.versions?.[version]?.dist;
  if (!dist?.tarball) throw new SourceError(`${name}@${version} has no tarball`);
  const tarball = await getHttps(dist.tarball, options, 'application/octet-stream');
  const tgz = await limitedBody(tarball, maxCompressed, 'the tarball');
  checkIntegrity(tgz, dist.integrity, 'the registry');
  await checkProvenance(name, version);
  return { ...filesOfTarball(tgz, `${name}@${version}`), requested: name };
}

/**
 * A plugin's two files from an `https://` tarball URL, checked against `--integrity` when given.
 *
 * @param url - The URL.
 * @param options - The fetch function and the integrity, if any.
 * @returns The two files.
 * @throws {SourceError} When the tarball cannot be fetched, does not match, or cannot be read.
 */
async function fromUrl(url: string, options: SourceOptions): Promise<PluginFiles> {
  const response = await getHttps(url, options, 'application/octet-stream');
  const tgz = await limitedBody(response, maxCompressed, 'the tarball');
  if (options.integrity !== undefined) checkIntegrity(tgz, options.integrity, '--integrity');
  return filesOfTarball(tgz, url);
}

/**
 * Finds a plugin's two files.
 *
 * @param spec - An npm name with an optional version or range, an `https://` URL, or a local
 *   `.tgz` or `.js` path.
 * @param options - The registry, the fetch function, the working directory, and the integrity an
 *   `https://` URL must match, if any.
 * @returns The two files.
 * @throws {SourceError} When they cannot be found or read safely.
 */
export async function fetchPlugin(spec: string, options: SourceOptions): Promise<PluginFiles> {
  if (spec.startsWith('http://')) throw new SourceError(`only https:// is fetched: ${spec}`);
  if (spec.startsWith('https://')) return fromUrl(spec, options);
  if (options.integrity !== undefined)
    throw new SourceError('--integrity applies only to an https:// tarball URL');
  if (!/\.(tgz|js)$/.test(spec)) return fromRegistry(spec, options);
  const path = resolve(options.workingDir, spec);
  if (!(await Bun.file(path).exists())) throw new SourceError(`no file at ${path}`);
  if (spec.endsWith('.js')) return localBundle(path);
  const file = Bun.file(path);
  if (file.size > maxCompressed)
    throw new SourceError(`${path} is larger than ${maxCompressed} bytes`);
  return filesOfTarball(new Uint8Array(await file.arrayBuffer()), path);
}
