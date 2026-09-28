/** How the connectors screen names and explains each access level. */
import type { AccessLevel } from '@querent/shared';

/** How one access level reads on the screen. */
interface AccessLevelCopy {
  /** The level. */
  readonly value: AccessLevel;
  /** The card title. */
  readonly title: string;
  /** The card text: what the model gets. */
  readonly description: string;
  /** The short name in the connector list. */
  readonly short: string;
}

/** The four levels, from least to most. */
export const accessLevels: readonly AccessLevelCopy[] = [
  {
    value: 1,
    title: 'Schema only',
    description: 'Tables, columns, types. Nothing else.',
    short: 'schema only',
  },
  {
    value: 2,
    title: 'Schema + metadata',
    description: 'Distinct values of small columns, row counts, test-run shapes.',
    short: 'metadata',
  },
  {
    value: 3,
    title: 'Aggregates',
    description: 'Min, max, spikes, top N. Lets it write up what happened.',
    short: 'aggregates',
  },
  {
    value: 4,
    title: 'Full access',
    description: 'Result rows, capped at the row limit below.',
    short: 'full access',
  },
];

/**
 * The short name of a level, for the connector list.
 *
 * @param level - The level.
 * @returns Such as `metadata`.
 */
export function accessLevelName(level: AccessLevel): string {
  return accessLevels.find((copy) => copy.value === level)?.short ?? `level ${level}`;
}
