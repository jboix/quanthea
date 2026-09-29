/** What a searchable dropdown lists for what the person typed. */

/** One choice of a searchable dropdown. */
export interface ComboboxOption {
  /** The value chosen. */
  readonly value: string;
  /** The visible text, searched with the value. */
  readonly label: string;
  /** The heading it sits under; options in one group come together. */
  readonly group?: string;
}

/** A listed choice: an option, or the typed text itself. */
export interface ComboboxItem extends ComboboxOption {
  /** Whether it is the typed text rather than an option. */
  readonly custom?: boolean;
}

/**
 * The options that match what was typed, and the typed text itself when it is allowed and no
 * option has it as its value. Every word typed must appear in the label or the value.
 *
 * @param options - The options, in order.
 * @param query - What was typed.
 * @param allowCustom - Whether any text may be chosen.
 * @returns The items to list.
 */
export function comboboxItems(
  options: readonly ComboboxOption[],
  query: string,
  allowCustom: boolean,
): ComboboxItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter((option) => {
    const text = `${option.label} ${option.value}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const typed = query.trim();
  const known = options.some((option) => option.value === typed);
  if (!allowCustom || typed === '' || known) return matches;
  return [...matches, { value: typed, label: `Use “${typed}”`, custom: true }];
}

/**
 * The text a value shows: its option's label, or the value itself.
 *
 * @param options - The options.
 * @param value - The value.
 * @returns The text.
 */
export function labelOf(options: readonly ComboboxOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
