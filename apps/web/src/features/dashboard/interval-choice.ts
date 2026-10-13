/**
 * The choice of the interval a time chart is cut into, on a report's run and on an alert: the
 * options of its chip, and the option a pick stands for. The chip is the dashboard's own, so the
 * choice is written as the variable a dashboard would declare.
 */
import { type ChartInterval, chartIntervals, type Variable } from '@quanthea/shared';

/**
 * The variable the chip shows.
 *
 * @param options - The choice nobody made, such as `auto` or `as stored`, then the others.
 * @returns A variable with those options, the first one its default.
 */
export function intervalVariable(options: readonly string[]): Variable {
  return {
    kind: 'custom',
    name: 'interval',
    label: 'Interval of the charts',
    options: [...options],
    default: options[0] ?? '',
  };
}

/**
 * The option a pick of the chip stands for.
 *
 * @param picked - What the chip gave: an option, or nothing to go back to the default.
 * @param options - The options offered, the choice nobody made first.
 * @returns The option, or the first one for nothing and for anything not offered.
 */
export function pickedOption<Option extends string>(
  picked: string | readonly string[],
  options: readonly Option[],
): Option | undefined {
  const [value] = [picked].flat();
  return options.find((each) => each === value) ?? options[0];
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
