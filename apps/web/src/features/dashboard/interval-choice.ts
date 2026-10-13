/**
 * The choice of the interval a time chart is cut into, on a report's run and on an alert: the
 * options of its chip, and the interval an option stands for. The chip is the dashboard's own, so
 * the choice is written as the variable a dashboard would declare.
 */
import { type ChartInterval, chartIntervals, type Variable } from '@quanthea/shared';

/**
 * The variable the chip shows: the choice nobody made, then the intervals to choose from.
 *
 * @param choices - The intervals that suit the period shown.
 * @param automatic - How the choice nobody made reads, such as `auto` or `as stored`.
 * @returns A variable with those options.
 */
export function intervalVariable(choices: readonly ChartInterval[], automatic: string): Variable {
  return {
    kind: 'custom',
    name: 'interval',
    label: 'Interval of the charts',
    options: [automatic, ...choices],
    default: automatic,
  };
}

/**
 * The interval an option of the chip stands for.
 *
 * @param option - What the chip gave: an option, or nothing to go back to the default.
 * @param choices - The intervals that suit the period shown.
 * @returns The interval, or `null` for the choice nobody made and for anything else.
 */
export function pickedInterval(
  option: string | readonly string[],
  choices: readonly ChartInterval[],
): ChartInterval | null {
  const [value] = [option].flat();
  const interval = chartIntervals.find((each) => each === value);
  return interval && choices.includes(interval) ? interval : null;
}

/**
 * The interval a URL names, if it is one of the closed list.
 *
 * @param value - The `interval` parameter.
 * @returns The interval, or `undefined` for none and for anything else.
 */
export function intervalParam(value: string | null): ChartInterval | undefined {
  return chartIntervals.find((each) => each === value);
}
