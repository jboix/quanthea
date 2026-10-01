import { describe, expect, test } from 'bun:test';
import type { ConnectorKindInfo } from '@querent/shared';
import { badgeTone, matchingKinds, needsDarkGlyph } from './kinds.ts';

/**
 * A kind with a name and nothing else of interest.
 *
 * @param kind - The identifier.
 * @param displayName - The name.
 * @returns The kind.
 */
function kindOf(kind: string, displayName: string): ConnectorKindInfo {
  return { kind, displayName, icon: null, language: 'sql', configSchema: {}, secretSchema: {} };
}

const kinds = [
  kindOf('postgres', 'PostgreSQL'),
  kindOf('mysql', 'MySQL'),
  kindOf('mariadb', 'MariaDB'),
  kindOf('clickhouse', 'ClickHouse'),
];

describe('matchingKinds', () => {
  test('matches every word in the name or the identifier, whatever the case', () => {
    expect(matchingKinds(kinds, 'maria').map((kind) => kind.kind)).toEqual(['mariadb']);
    expect(matchingKinds(kinds, 'POSTGRES').map((kind) => kind.kind)).toEqual(['postgres']);
    expect(matchingKinds(kinds, 'sql').map((kind) => kind.kind)).toEqual(['postgres', 'mysql']);
    expect(matchingKinds(kinds, 'post sql').map((kind) => kind.kind)).toEqual(['postgres']);
    expect(matchingKinds(kinds, 'oracle')).toEqual([]);
  });

  test('keeps every kind, in order, for an empty search', () => {
    expect(matchingKinds(kinds, '  ')).toEqual(kinds);
  });
});

describe('kind badges', () => {
  test('draw a dark logo on light brand colours and a light one on dark colours', () => {
    expect(needsDarkGlyph('#FFCC01')).toBe(true);
    expect(needsDarkGlyph('#4169E1')).toBe(false);
    expect(needsDarkGlyph('#DD00A1')).toBe(false);
  });

  test('keep the same tone for the same kind', () => {
    expect(badgeTone('postgres')).toBe(badgeTone('postgres'));
  });
});
