import { intervalVariable, pickedOption } from './interval-choice.ts';
import { OptionChip } from './variable-chip.tsx';

/** Props of {@link IntervalChip}. */
interface IntervalChipProps<Option extends string> {
  /** What it offers: the choice nobody made, such as `auto`, then the intervals to choose. */
  readonly options: readonly Option[];
  /** The option chosen. */
  readonly value: Option;
  /** Called with the option chosen. */
  readonly onChange: (option: Option) => void;
}

/**
 * The chip that chooses the interval the time charts are cut into, on a report's run and on an
 * alert: the chip of a dashboard's interval variable, with a closed list of options. It gives an
 * option of that list and nothing else.
 *
 * @param props - The options, the one chosen and the change callback.
 * @returns The chip with its menu.
 */
export function IntervalChip<Option extends string>(props: IntervalChipProps<Option>) {
  const { options, value, onChange } = props;
  const choose = (picked: string | readonly string[]) => {
    const option = pickedOption(picked, options);
    if (option !== undefined) onChange(option);
  };
  return (
    <OptionChip
      variable={intervalVariable(options)}
      value={value}
      onChange={choose}
      optionsUrl=""
    />
  );
}
