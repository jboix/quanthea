import { costOf, pricesCheckedOn, type TurnUsage } from '@querent/shared';
import styles from './conversation.module.css';

/** Short token counts, such as `31k` or `1.2k`. */
const tokenCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * A dollar amount with two significant digits, so small costs stay readable.
 *
 * @param dollars - The amount.
 * @returns Such as `$0.0042` or `$1.3`.
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
 * The tokens of a usage, added over its models.
 *
 * @param usage - The usage.
 * @returns Fresh input, cached input and output.
 */
function totals(usage: TurnUsage) {
  return Object.values(usage).reduce(
    (sum, tokens) => ({
      input: sum.input + tokens.input + tokens.cacheWrite,
      cached: sum.cached + tokens.cachedInput,
      output: sum.output + tokens.output,
    }),
    { input: 0, cached: 0, output: 0 },
  );
}

/**
 * The cost words of a usage: the list price, and the models without one.
 *
 * @param usage - The usage.
 * @returns Such as `about $0.004`, or `cost unknown for gemma-4`.
 */
export function costText(usage: TurnUsage): string {
  const { dollars, unpriced } = costOf(usage);
  if (unpriced.length === Object.keys(usage).length)
    return `cost unknown for ${unpriced.join(', ')}`;
  const partial = unpriced.length > 0 ? ` plus ${unpriced.join(', ')}` : '';
  return `about ${dollarsText(dollars)}${partial}`;
}

/**
 * What an answer cost: its tokens, and the list price where the model is known.
 *
 * @param props - The usage.
 * @param props.usage - The answer's usage, by model.
 * @returns The line, or nothing for an answer without usage.
 */
export function UsageLine({ usage }: { readonly usage: TurnUsage | undefined }) {
  if (usage === undefined || Object.keys(usage).length === 0) return null;
  const { input, cached, output } = totals(usage);
  const cachedPart = cached > 0 ? ` · ${tokenCount.format(cached)} cached` : '';
  return (
    <p className={styles.usage} title={`List prices checked on ${pricesCheckedOn}.`}>
      {tokenCount.format(input)} in{cachedPart} · {tokenCount.format(output)} out ·{' '}
      {costText(usage)}
    </p>
  );
}
