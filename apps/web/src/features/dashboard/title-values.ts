/**
 * The values a title is filled with: the page's choices, and the computed variables it names, which
 * only the server reads. A title with no computed variable loads nothing.
 */
import {
  computedInTitle,
  type DashboardSpec,
  type Variable,
  type VariableValues,
} from '@quanthea/shared';
import { useEffect, useMemo } from 'react';
import { useFetcher } from 'react-router';
import { choicesFromSearch } from './view-state.ts';

/** Where a page runs: the version, and its choices as search parameters. */
interface TitleTarget {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version shown. */
  readonly version: number;
  /** The variables and the time range, as the address writes them. */
  readonly search: string;
}

/**
 * The address of the computed values a title names, for the page's choices.
 *
 * @param target - The page's run target.
 * @param names - The computed variables.
 * @returns The address, or `undefined` when there is nothing to load.
 */
function computedUrl(
  target: TitleTarget | undefined,
  names: readonly string[],
): string | undefined {
  if (!target || names.length === 0) return undefined;
  const search = new URLSearchParams(target.search);
  for (const name of names) search.append('computed', name);
  return `/d/${target.dashboardId}/v/${target.version}/computed?${search.toString()}`;
}

/**
 * Computed values as a title shows them: one value, or the list for a variable with `multi`.
 *
 * @param variables - The spec's variables.
 * @param loaded - The values the server read, by name.
 * @returns The values.
 */
function asChoices(
  variables: readonly Variable[],
  loaded: Readonly<Record<string, readonly string[]>>,
): VariableValues {
  const choices: Record<string, string | string[]> = {};
  for (const [name, values] of Object.entries(loaded)) {
    const variable = variables.find((each) => each.name === name);
    const multi = variable?.kind === 'computed' && variable.multi === true;
    const [first] = values;
    if (multi) choices[name] = [...values];
    else if (first !== undefined) choices[name] = first;
  }
  return choices;
}

/**
 * The values to fill a title with: the choices of the run target, and the values the server reads
 * for the computed variables the title names.
 *
 * @param title - The title, as stored.
 * @param spec - The spec.
 * @param target - The page's run target; without one, only the choices' defaults.
 * @returns The values, by name.
 */
export function useTitleValues(
  title: string,
  spec: DashboardSpec,
  target: TitleTarget | undefined,
): VariableValues {
  const chosen = useMemo(
    () => choicesFromSearch(new URLSearchParams(target?.search ?? ''), spec).variables,
    [target?.search, spec],
  );
  const url = computedUrl(target, computedInTitle(title, spec.variables));
  const fetcher = useFetcher<Record<string, string[]>>();
  const { load } = fetcher;
  useEffect(() => {
    if (url) void load(url);
  }, [load, url]);
  const computed = useMemo(
    () => (url && fetcher.data ? asChoices(spec.variables, fetcher.data) : {}),
    [url, fetcher.data, spec.variables],
  );
  return useMemo(() => ({ ...chosen, ...computed }), [chosen, computed]);
}
