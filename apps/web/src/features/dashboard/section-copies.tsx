import {
  allValue,
  copyLimit,
  type DashboardSpec,
  labelOfValue,
  optionValues,
  type Panel,
  type Section,
  type VariableOption,
  variableDefault,
} from '@quanthea/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Tabs, tabPanelProps } from '../../ui/tabs.tsx';
import type { Loaded } from './data.ts';
import type { RunTarget } from './panel-card.tsx';
import { SpacedGrid } from './panel-grid.tsx';
import styles from './sections.module.css';
import { choicesFromSearch } from './view-state.ts';

/** One copy of a repeated section: the variable it repeats over, and its one value. */
export interface SectionCopy {
  /** The variable's name. */
  readonly variable: string;
  /** The value this copy shows. */
  readonly value: string;
}

/** Draws one panel, in a copy of a repeated section when given one. */
export type CardDrawer = (panel: Panel, copy?: SectionCopy) => ReactNode;

/**
 * The run target of a copy: the page's choices with the repeated variable set to the copy's
 * value, and the copy named so its runs keep apart from the other copies'.
 *
 * @param target - The page's run target.
 * @param copy - The copy.
 * @returns The copy's target.
 */
export function copyTarget(target: RunTarget, copy: SectionCopy): RunTarget {
  const search = new URLSearchParams(target.search);
  search.set(`var-${copy.variable}`, copy.value);
  return { ...target, search: search.toString(), copy: copy.value };
}

/**
 * The values a repeated section is drawn for: those chosen, or every option for "All", loading a
 * query-backed variable's options when it needs them. At most the copies the section may draw.
 *
 * @param spec - The spec.
 * @param section - The section, which repeats.
 * @param target - The page's run target, for the choices and where options load from.
 * @returns The values, and the options for their labels.
 */
function useCopyValues(spec: DashboardSpec, section: Section, target: RunTarget) {
  const name = section.repeat ?? '';
  const variable = spec.variables.find((each) => each.name === name);
  const chosen = choicesFromSearch(new URLSearchParams(target.search), spec).variables[name];
  const values = [chosen ?? (variable ? variableDefault(variable) : undefined) ?? []].flat();
  const all = values.includes(allValue);
  const fetcher = useFetcher<Loaded<VariableOption[]>>();
  const loadable = all && variable?.kind === 'query';
  const url = `/d/${target.dashboardId}/v/${target.version}/options/${name}?${target.search}`;
  const { load } = fetcher;
  useEffect(() => {
    if (loadable) void load(url);
  }, [loadable, load, url]);
  const options =
    variable?.kind === 'custom' ? variable.options : fetcher.data?.ok ? fetcher.data.value : [];
  const listed = all ? optionValues(options) : values;
  return { values: listed.slice(0, copyLimit(spec, section.id)), options };
}

/** Props of the copies of a repeated section. */
interface CopiesProps {
  /** The spec. */
  readonly spec: DashboardSpec;
  /** The section, which repeats. */
  readonly section: Section;
  /** Its panels, moved up to its first row. */
  readonly panels: readonly Panel[];
  /** Draws one panel in a copy. */
  readonly card: CardDrawer;
}

/** Props of the list of copies: the section's, with the values and their options. */
type CopyListProps = Omit<CopiesProps, 'spec'> & {
  /** The values, one copy each. */
  readonly values: readonly string[];
  /** The variable's options, for the values' labels. */
  readonly options: readonly VariableOption[];
};

/**
 * The copies of a repeated section: a tab for each value, and the chosen value's copy alone, its
 * panels bound to that value, so the other copies run nothing until chosen.
 *
 * @param props - The section, its panels, the drawer, the values and their options.
 * @returns The tabs and the chosen copy.
 */
function CopyList({ section, panels, card, values, options }: CopyListProps) {
  const [chosen, choose] = useState(0);
  const variable = section.repeat ?? '';
  const index = chosen < values.length ? chosen : 0;
  const value = values[index];
  const name = `section-${section.id}`;
  const tabs = values.map((each, at) => ({ id: String(at), label: labelOfValue(options, each) }));
  return (
    <div className={styles.copy}>
      <Tabs
        label={section.title}
        tabs={tabs}
        selected={String(index)}
        onSelect={(id) => choose(Number(id))}
        panels={name}
      />
      {value !== undefined && (
        <div {...tabPanelProps(name, String(index))} className={styles.tabPanel}>
          <SpacedGrid panels={panels} card={(panel) => card(panel, { variable, value })} />
        </div>
      )}
    </div>
  );
}

/**
 * The copies of a repeated section on a page that runs its panels, one for each value chosen.
 *
 * @param props - The spec, the section, its panels, the drawer and the page's run target.
 * @param props.target - The page's run target.
 * @returns The copies.
 */
export function SectionCopies(props: CopiesProps & { readonly target: RunTarget }) {
  const { values, options } = useCopyValues(props.spec, props.section, props.target);
  return <CopyList {...props} values={values} options={options} />;
}

/**
 * The values a snapshot froze a repeated section for, read from the keys of its runs.
 *
 * @param keys - The keys of the snapshot's runs: a panel's id, or its id, `#` and a value.
 * @param panels - The section's panels.
 * @returns The values, in the order frozen.
 */
function frozenValues(keys: readonly string[], panels: readonly Panel[]): string[] {
  const prefixes = panels.map((panel) => `${panel.id}#`);
  const values = keys.flatMap((key) => {
    const prefix = prefixes.find((each) => key.startsWith(each));
    return prefix ? [key.slice(prefix.length)] : [];
  });
  return [...new Set(values)];
}

/**
 * The copies of a repeated section in a snapshot: one for each value it froze.
 *
 * @param props - The spec, the section, its panels, the drawer and the keys of the frozen runs.
 * @param props.frozen - The keys of the snapshot's runs.
 * @returns The copies.
 */
export function FrozenCopies(props: CopiesProps & { readonly frozen: readonly string[] }) {
  const variable = props.spec.variables.find((each) => each.name === props.section.repeat);
  const options = variable?.kind === 'custom' ? variable.options : [];
  const values = frozenValues(props.frozen, props.panels);
  return <CopyList {...props} values={values} options={options} />;
}
