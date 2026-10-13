import type { ChartInterval } from '@quanthea/shared';
import { intervalVariable, pickedInterval } from './interval-choice.ts';
import { OptionChip } from './variable-chip.tsx';

/** Props of {@link IntervalChip}. */
interface IntervalChipProps {
  /** The intervals that suit the period shown. */
  readonly choices: readonly ChartInterval[];
  /** The interval chosen, or `null` when nobody chose. */
  readonly value: ChartInterval | null;
  /** How the choice nobody made reads, such as `auto` or `as stored`. */
  readonly automatic: string;
  /** Called with the interval chosen, or `null` to go back to the automatic one. */
  readonly onChange: (interval: ChartInterval | null) => void;
}

/**
 * The chip that chooses the interval the time charts are cut into, on a report's run and on an
 * alert: the chip of a dashboard's interval variable, with a closed list of options. It gives a
 * name of that list and nothing else, and the server binds it.
 *
 * @param props - The choices, the value, the automatic choice's words and the change callback.
 * @returns The chip with its menu.
 */
export function IntervalChip({ choices, value, automatic, onChange }: IntervalChipProps) {
  return (
    <OptionChip
      variable={intervalVariable(choices, automatic)}
      value={value ?? automatic}
      onChange={(option) => onChange(pickedInterval(option, choices))}
      optionsUrl=""
    />
  );
}
