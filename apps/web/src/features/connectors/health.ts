/** The connection test of a connector, shared by every component that shows it. */
import type { healthReportSchema } from '@querent/shared';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import type { z } from 'zod';

/** The result of a connection test. */
type HealthReport = z.output<typeof healthReportSchema>;

/** A connector's health as the screen shows it. */
export interface Health {
  /** The last report, if a test has finished. */
  readonly report: HealthReport | undefined;
  /** Whether a test is running. */
  readonly testing: boolean;
  /** Runs the test again. */
  readonly retest: () => void;
}

/**
 * The health of a connector. Every caller shares one fetcher per connector version, so the list dot
 * and the header pill show the same test, and a changed connector is tested again.
 *
 * @param connectorId - The connector.
 * @param version - Changes when the settings change: the connector's `updatedAt`.
 * @returns The health. The first caller starts a test.
 */
export function useHealth(connectorId: string, version: number): Health {
  const fetcher = useFetcher<HealthReport>({ key: `connector-health-${connectorId}-${version}` });
  const path = `/connectors/${connectorId}/health`;
  const { load, state, data } = fetcher;
  const untested = state === 'idle' && data === undefined;
  useEffect(() => {
    if (untested) void load(path);
  }, [load, path, untested]);
  return { report: data, testing: state !== 'idle', retest: () => void load(path) };
}

/**
 * The dot status of a health.
 *
 * @param health - The health.
 * @returns `ok`, `failed`, or `unknown` while nothing is known.
 */
export function healthStatus(health: Health): 'ok' | 'failed' | 'unknown' {
  if (!health.report) return 'unknown';
  return health.report.ok ? 'ok' : 'failed';
}
