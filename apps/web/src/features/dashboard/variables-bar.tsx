import {
  type ChosenVariable,
  type DashboardSpec,
  isChosen,
  type PanelAlert,
  type TimeRangeExpression,
} from '@quanthea/shared';
import type { ReactNode } from 'react';
import { withMarkersShown } from './marker-sets.ts';
import { MarkerToggles } from './marker-toggles.tsx';
import { OptionToggleChips } from './option-toggle-chips.tsx';
import { toggleOptions } from './option-toggles.ts';
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
  /** The URL's search parameters, every choice included. */
  readonly search: URLSearchParams;
  /** The ids of the sets of markers the viewer hid. */
  readonly hiddenMarkers: ReadonlySet<string>;
  /** The alerts linked to panels, whose firing periods toggle like a set of markers. */
  readonly alertSets?: readonly PanelAlert[] | undefined;
  /** The version the options load from. */
  readonly target: RunTarget;
  /** Called with the new URL parameters. */
  readonly onSearch: (search: URLSearchParams) => void;
  /** Controls at the end of the bar, such as Refresh. */
  readonly actions?: ReactNode;
}

/**
 * How a viewer chooses one variable: a field for text, a toggle per option for a few short
 * options of a variable that holds several, else a chip with a menu.
 *
 * @param props - The variable, its value, the change callback and where its options load from.
 * @param props.variable - The variable.
 * @param props.value - The value chosen.
 * @param props.onChange - Called with the new value.
 * @param props.optionsUrl - Where query-backed options load from.
 * @returns The control.
 */
function VariableControl({
  variable,
  value,
  onChange,
  optionsUrl,
}: {
  readonly variable: ChosenVariable;
  readonly value: string | readonly string[];
  readonly onChange: (next: string | readonly string[]) => void;
  readonly optionsUrl: string;
}) {
  if (variable.kind === 'text')
    return <TextChip variable={variable} value={value} onChange={onChange} />;
  const toggles = toggleOptions(variable);
  if (toggles)
    return (
      <OptionToggleChips variable={variable} options={toggles} value={value} onChange={onChange} />
    );
  return (
    <OptionChip variable={variable} value={value} onChange={onChange} optionsUrl={optionsUrl} />
  );
}

/**
 * The time range and the variables, as chips, a toggle per set of markers and per linked alert's
 * firing periods, and any controls at the end. Changing them changes the URL and what the panels show, never the saved dashboard.
 *
 * @param props - The spec, the choices, the target, the change callback and the controls.
 * @returns The bar.
 */
export function VariablesBar(props: VariablesBarProps) {
  const { spec, choices, target, search, onSearch, actions } = props;
  const setTime = (time: TimeRangeExpression | undefined) => onSearch(withTime(search, time));
  return (
    <div className={styles.bar}>
      <TimePicker spec={spec} picked={choices.time} onPick={setTime} />
      {spec.variables.filter(isChosen).map((variable) => (
        <VariableControl
          key={variable.name}
          variable={variable}
          value={choices.variables[variable.name] ?? variable.default ?? []}
          onChange={(next) => onSearch(withVariable(search, variable.name, next))}
          optionsUrl={`/d/${target.dashboardId}/v/${target.version}/options/${variable.name}?${target.search}`}
        />
      ))}
      <MarkerToggles
        spec={spec}
        alerts={props.alertSets ?? []}
        hidden={props.hiddenMarkers}
        onToggle={(id, shown) => onSearch(withMarkersShown(search, id, shown))}
      />
      {actions && <span className={styles.actions}>{actions}</span>}
    </div>
  );
}
