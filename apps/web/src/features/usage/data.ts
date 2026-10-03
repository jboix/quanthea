/** Loads the usage report for the range in the address, and reads how its charts split. */
import { type UsageReport, usageReportEndpoint } from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import type { UsageSplit } from './usage-charts.ts';

/** The ranges the screen offers, in days. */
export const usageRanges = [7, 30, 90] as const;

/** What the usage screen shows. */
export interface UsageData {
  /** The report. */
  readonly report: UsageReport;
  /** The range, in days. */
  readonly days: number;
  /** How the token and cost charts split each day. */
  readonly split: UsageSplit;
}

/**
 * The address of the usage screen for a range and a split. The split by model is the default and
 * stays out of the address.
 *
 * @param days - The range, in days.
 * @param split - By model or by feature.
 * @returns The search part, such as `?days=30&by=feature`.
 */
export function usageSearch(days: number, split: UsageSplit): string {
  return split === 'feature' ? `?days=${days}&by=feature` : `?days=${days}`;
}

/**
 * The range and the split an address asks for: the last 30 days by model unless it says otherwise.
 *
 * @param search - The address's search parameters.
 * @returns The range, in days, and the split.
 */
export function usageView(search: URLSearchParams): Pick<UsageData, 'days' | 'split'> {
  const asked = Number(search.get('days'));
  const days = usageRanges.find((range) => range === asked) ?? 30;
  return { days, split: search.get('by') === 'feature' ? 'feature' : 'model' };
}

/**
 * The loader of the usage screen: the range and the split in the address.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadUsage(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<UsageData> => {
    const { days, split } = usageView(new URL(request.url).searchParams);
    const report = await api.call(
      usageReportEndpoint,
      { query: { days } },
      { signal: request.signal },
    );
    return { report, days, split };
  };
}
