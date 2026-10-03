import styles from './usage.module.css';
import type { FeatureUsage } from './usage-features.ts';

/** Short numbers, such as 12.4K. */
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Dollars, with two significant digits. */
const money = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
});

/**
 * What each feature spent: building dashboards, questions about them, panel explanations. The
 * costliest first.
 *
 * @param props - The rows.
 * @param props.features - One row per feature that ran a model.
 * @returns The table, or a note when nothing ran.
 */
export function FeaturesTable({ features }: { readonly features: readonly FeatureUsage[] }) {
  if (features.length === 0) return <p className={styles.empty}>No model ran in this range.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Feature</th>
          <th>Steps</th>
          <th>Fresh input</th>
          <th>Cached</th>
          <th>Output</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {features.map((row) => (
          <tr key={row.feature}>
            <td>{row.name}</td>
            <td>{row.steps}</td>
            <td>{count.format(row.input)}</td>
            <td>{count.format(row.cached)}</td>
            <td>{count.format(row.output)}</td>
            <td>{row.unpriced ? 'no price' : money.format(row.dollars)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
