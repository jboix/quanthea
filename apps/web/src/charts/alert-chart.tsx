/** An alert's chart: its series over a window, the threshold and the periods it fired. */
import { useMemo } from 'react';
import { type AlertChartInput, buildAlertOption } from './alert-option.ts';
import { OptionChart } from './chart.tsx';
import { useChartTheme } from './theme.ts';

/** Props of {@link AlertChart}. */
interface AlertChartProps {
  /** What the chart draws. */
  readonly input: AlertChartInput;
  /** The IANA time zone for times, or the browser's. */
  readonly timeZone?: string | undefined;
  /** What the chart shows, for screen readers. */
  readonly label: string;
}

/**
 * Draws an alert's series with its threshold, the periods it fired shaded.
 *
 * @param props - What it draws, the time zone and a label.
 * @returns The chart container.
 */
export function AlertChart({ input, timeZone, label }: AlertChartProps) {
  const theme = useChartTheme();
  const option = useMemo(() => buildAlertOption(input, theme, timeZone), [input, theme, timeZone]);
  return <OptionChart option={option} label={label} />;
}
