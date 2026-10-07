/** Telling connector kinds apart: their badge colours and the search of the kind picker. */
import type { ConnectorKindInfo } from '@quanthea/shared';

/** The badge tones of kinds without a logo, picked by kind so each kind keeps its tone. */
const badgeTones = ['accent', 'draft', 'ok', 'plain'] as const;

/**
 * The badge tone of a kind without a logo.
 *
 * @param kind - The kind identifier.
 * @returns A tone, stable for the kind.
 */
export function badgeTone(kind: string): (typeof badgeTones)[number] {
  const sum = [...kind].reduce((total, character) => total + character.charCodeAt(0), 0);
  return badgeTones[sum % badgeTones.length] ?? 'plain';
}

/**
 * Whether a logo on a background of this colour is drawn dark, because the colour is light.
 *
 * @param color - The background, as `#rrggbb`.
 * @returns `true` for a light background, such as yellow.
 */
export function needsDarkGlyph(color: string): boolean {
  const channel = (offset: number): number => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.35;
}

/**
 * The kinds whose name, identifier or aliases hold every word of a search.
 *
 * @param kinds - The kinds.
 * @param search - What the admin typed.
 * @returns The matching kinds, in their order; all of them for an empty search.
 */
export function matchingKinds(
  kinds: readonly ConnectorKindInfo[],
  search: string,
): ConnectorKindInfo[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return kinds.filter((kind) => {
    const text = [kind.displayName, kind.kind, ...kind.aliases].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * How the interface names a kind's plugin, if a plugin adds it.
 *
 * @param kind - The kind.
 * @returns Such as `plugin · v1.2.0`, or `undefined` for a built-in kind.
 */
export function pluginLabel(
  kind: Pick<ConnectorKindInfo, 'plugin'> | undefined,
): string | undefined {
  return kind?.plugin ? `plugin · v${kind.plugin.version}` : undefined;
}

/**
 * Databases a built-in kind reads as well, under another name: an extension or a fork that
 * speaks the same protocol, so the tile says so and nobody looks for a kind of its own.
 */
const readsAlso: Readonly<Record<string, string>> = { postgres: 'TimescaleDB' };

/**
 * The second line of a kind's tile: the plugin that adds it, or what else the kind reads.
 *
 * @param kind - The kind.
 * @returns Such as `plugin · v1.2.0` or `and TimescaleDB`, or `undefined` for none.
 */
export function kindNote(kind: Pick<ConnectorKindInfo, 'kind' | 'plugin'>): string | undefined {
  if (kind.plugin) return pluginLabel(kind);
  const also = readsAlso[kind.kind];
  return also ? `and ${also}` : undefined;
}
