import { lazy, Suspense } from 'react';
import { Link, useLoaderData } from 'react-router';
import type { ChartInput } from '../../charts/index.ts';
import { Card } from '../../ui/card.tsx';
import { Page } from '../../ui/page.tsx';
import { type UsageData, usageRanges } from './data.ts';
import { PeopleTable } from './people-table.tsx';
import styles from './usage.module.css';
import { costChart, tokensChart, viewsChart } from './usage-charts.ts';
import {
  chartedModels,
  dailyUsage,
  type ModelUsage,
  totalUsage,
  usageByModel,
} from './usage-days.ts';
import { usageByUser } from './usage-people.ts';

/** The chart, loaded when first drawn, so pages without charts never load ECharts. */
const Chart = lazy(async () => ({ default: (await import('../../charts/index.ts')).Chart }));

/** Token counts such as `31K`. */
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Dollars with two significant digits, so small amounts stay readable.
 *
 * @param dollars - The amount.
 * @returns Such as `$0.0042`.
 */
function dollarsText(dollars: number): string {
  if (dollars === 0) return '$0';
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumSignificantDigits: 2,
  }).format(dollars);
}

/**
 * The range links: 7, 30 or 90 days.
 *
 * @param props - The range shown.
 * @param props.days - The range, in days.
 * @returns The links.
 */
function RangeLinks({ days }: { readonly days: number }) {
  return (
    <nav className={styles.ranges} aria-label="Range">
      {usageRanges.map((range) => (
        <Link
          key={range}
          to={`?days=${range}`}
          className={styles.range}
          aria-current={range === days ? 'page' : undefined}
        >
          {range} days
        </Link>
      ))}
    </nav>
  );
}

/**
 * The totals of the range.
 *
 * @param props - The totals and when prices were checked.
 * @param props.total - The totals.
 * @param props.checkedOn - When the prices were checked.
 * @returns The figures.
 */
function Figures({
  total,
  checkedOn,
}: {
  readonly total: ReturnType<typeof totalUsage>;
  readonly checkedOn: string;
}) {
  const figures = [
    [
      'Tokens',
      count.format(total.input + total.cached + total.output),
      `${count.format(total.cached)} cached · ${count.format(total.output)} out`,
    ],
    ['List-price cost', dollarsText(total.dollars), `Prices checked on ${checkedOn}`],
    ['Model steps', String(total.steps), 'One request each'],
    ['Views', String(total.views), 'Pinned dashboards and snapshots; no model runs'],
  ] as const;
  return (
    <dl className={styles.figures}>
      {figures.map(([label, value, note]) => (
        <div key={label} className={styles.figure}>
          <dt>{label}</dt>
          <dd>{value}</dd>
          <span>{note}</span>
        </div>
      ))}
    </dl>
  );
}

/**
 * A chart in a card.
 *
 * @param props - The title and the chart input.
 * @param props.title - The title.
 * @param props.input - The chart input.
 * @returns The card.
 */
function ChartCard({ title, input }: { readonly title: string; readonly input: ChartInput }) {
  return (
    <Card title={title}>
      <div className={styles.chart}>
        <Suspense fallback={null}>
          <Chart input={input} label={title} />
        </Suspense>
      </div>
    </Card>
  );
}

/**
 * The usage of each model.
 *
 * @param props - The rows.
 * @param props.models - One row per model.
 * @returns The table, or a note when nothing ran.
 */
function ModelsTable({ models }: { readonly models: readonly ModelUsage[] }) {
  if (models.length === 0) return <p className={styles.empty}>No model ran in this range.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Model</th>
          <th>Provider</th>
          <th>Steps</th>
          <th>Fresh input</th>
          <th>Cached</th>
          <th>Output</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {models.map((row) => (
          <tr key={`${row.provider}/${row.model}`}>
            <td className={styles.mono}>{row.model}</td>
            <td>{row.provider}</td>
            <td>{row.steps}</td>
            <td>{count.format(row.input)}</td>
            <td>{count.format(row.cached)}</td>
            <td>{count.format(row.output)}</td>
            <td>{row.unpriced ? 'no price' : dollarsText(row.dollars)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Settings → Usage: what the model steps spent and how often pinned dashboards were read, from the
 * ledger that outlives threads.
 *
 * @returns The screen.
 */
export function UsageScreen() {
  const { report, days } = useLoaderData() as UsageData;
  const daily = dailyUsage(report);
  const models = usageByModel(report);
  const charted = chartedModels(models);
  return (
    <Page
      title="Usage"
      subtitle="What the models spent, at list prices, and how often pinned dashboards were read. Kept when threads are deleted."
      actions={<RangeLinks days={days} />}
    >
      <Figures total={totalUsage(daily)} checkedOn={report.pricesCheckedOn} />
      <div className={styles.charts}>
        <ChartCard title="Tokens per day, by model" input={tokensChart(daily, charted)} />
        <ChartCard title="List-price cost per day, by model" input={costChart(daily, charted)} />
        <ChartCard
          title="Views per day, pinned dashboards and snapshots"
          input={viewsChart(daily)}
        />
      </div>
      <Card title="By model">
        <ModelsTable models={models} />
      </Card>
      <Card title="By person" description="The model steps that ran in each person’s threads.">
        <PeopleTable people={usageByUser(report)} />
      </Card>
    </Page>
  );
}
