import type { DashboardSpec, TimeRangeExpression } from '@querent/shared';
import type { ReactNode } from 'react';
import type { RunTarget } from './panel-card.tsx';
import { TimePicker } from './time-picker.tsx';
import { OptionChip, TextChip } from './variable-chip.tsx';
import styles from './variables-bar.module.css';
import { type ViewChoices, withTime, withVariable } from './view-state.ts';

/** Props of {@link VariablesBar}. */
interface VariablesBarProps {
  /** The spec. */
  readonly spec: DashboardSpec;
  /** The viewer's choices. */
  readonly choices: ViewChoices;
  /** The version the options load from. */
  readonly target: RunTarget;
  /** Called with the new URL parameters. */
  readonly onSearch: (search: URLSearchParams) => void;
  /** Controls at the end of the bar, such as Refresh. */
  readonly actions?: ReactNode;
}

/**
 * The time range and the variables, as chips, and any controls at the end. Changing them changes
 * the URL and what the panels show, never the saved dashboard.
 *
 * @param props - The spec, the choices, the target, the change callback and the controls.
 * @returns The bar.
 */
export function VariablesBar({ spec, choices, target, onSearch, actions }: VariablesBarProps) {
  const search = new URLSearchParams(target.search);
  const setTime = (time: TimeRangeExpression | undefined) => onSearch(withTime(search, time));
  return (
    <div className={styles.bar}>
      <TimePicker spec={spec} picked={choices.time} onPick={setTime} />
      {spec.variables.map((variable) => {
        const value = choices.variables[variable.name] ?? variable.default ?? [];
        const onChange = (next: string | readonly string[]) =>
          onSearch(withVariable(search, variable.name, next));
        const optionsUrl = `/d/${target.dashboardId}/v/${target.version}/options/${variable.name}?${target.search}`;
        return variable.kind === 'text' ? (
          <TextChip key={variable.name} variable={variable} value={value} onChange={onChange} />
        ) : (
          <OptionChip
            key={variable.name}
            variable={variable}
            value={value}
            onChange={onChange}
            optionsUrl={optionsUrl}
          />
        );
      })}
      {actions && <span className={styles.actions}>{actions}</span>}
    </div>
  );
}
