/** Loads the usage report for the range in the address. */
import { type UsageReport, usageReportEndpoint } from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';

/** The ranges the screen offers, in days. */
export const usageRanges = [7, 30, 90] as const;

/** What the usage screen shows. */
export interface UsageData {
  /** The report. */
  readonly report: UsageReport;
  /** The range, in days. */
  readonly days: number;
}

/**
 * The loader of the usage screen: the last 30 days, or the range in `?days=`.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadUsage(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<UsageData> => {
    const asked = Number(new URL(request.url).searchParams.get('days'));
    const days = usageRanges.find((range) => range === asked) ?? 30;
    const report = await api.call(
      usageReportEndpoint,
      { query: { days } },
      { signal: request.signal },
    );
    return { report, days };
  };
}
