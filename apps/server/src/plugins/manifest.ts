/**
 * A plugin's manifest: its `package.json`, of which quanthea reads the name, the version and the
 * `quanthea` field, which names the kit version and the bundle.
 */
import { z } from 'zod';
import { pluginNameSchema } from '../config/config.ts';

/** The kit versions this server loads plugins for. */
export const supportedKitVersions: readonly number[] = [0];

/** A semantic version, such as `1.2.0` or `2.0.0-beta.1`. */
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The bundle's path in the package: relative, no `..`, a `.js` file. */
const mainPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.js$/;

/** Validates the fields of a manifest quanthea reads; the others are the package's own. */
export const manifestSchema = z.object({
  name: pluginNameSchema,
  version: z.string().regex(versionPattern, 'The version is not a semantic version.'),
  keywords: z.array(z.string()).optional(),
  quanthea: z.strictObject({
    kitVersion: z.int().nonnegative(),
    main: z.string().regex(mainPattern, 'main is a relative path to a .js file, without "..".'),
  }),
});

/** A manifest. */
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Reads a manifest.
 *
 * @param text - The `package.json` text.
 * @returns The manifest, or the problem with it.
 */
export function readManifest(text: string): { manifest: Manifest } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problem: 'package.json is not JSON' };
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return { problem: `package.json ${issue?.path.join('.') || ''}: ${issue?.message ?? ''}` };
  }
  if (!supportedKitVersions.includes(parsed.data.quanthea.kitVersion))
    return {
      problem: `kit version ${parsed.data.quanthea.kitVersion} is not supported: this server loads ${supportedKitVersions.join(', ')}`,
    };
  return { manifest: parsed.data };
}
