/** Checks a query against its connector's guardrails before it runs. */
import type { Guardrails } from '@querent/shared';
import type { TimeRange } from '../connectors/_shared/index.ts';
import { QueryError } from './query-error.ts';

/** Milliseconds per day. */
const day = 86_400_000;

/**
 * Checks the time range: it must run forwards and be no longer than the connector allows.
 *
 * @param timeRange - The time range of the query.
 * @param guardrails - The connector's guardrails.
 * @throws {QueryError} `guardrail` when the range is reversed or too long.
 */
export function checkTimeRange(timeRange: TimeRange, guardrails: Guardrails): void {
  const length = timeRange.to.getTime() - timeRange.from.getTime();
  if (!(length >= 0)) throw new QueryError('guardrail', 'The time range ends before it starts.');
  if (length > guardrails.maxRangeDays * day) {
    throw new QueryError(
      'guardrail',
      `The time range is longer than this connector allows (${guardrails.maxRangeDays} days).`,
    );
  }
}
