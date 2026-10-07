/**
 * Checks that the names in a spec fit together: unique panel, annotation and variable names,
 * views bound to their panel's refIds, markers bound to annotations, and variable defaults among
 * their options.
 */
import {
  type DashboardSpec,
  isMultiValue,
  maxTextValueLength,
  type Panel,
  type Variable,
  type View,
} from '@quanthea/shared';
import type { SpecIssue } from './issues.ts';
import { slowPattern } from './safe-pattern.ts';

/**
 * Reports the names that appear more than once.
 *
 * @param names - The names, in order.
 * @param path - The path of the list, such as `panels`.
 * @param key - The name's key in each item, such as `id`.
 * @returns An issue for each repeat.
 */
function duplicates(names: readonly string[], path: string, key: string): SpecIssue[] {
  return names.flatMap((name, index) =>
    names.indexOf(name) === index
      ? []
      : [{ path: `${path}[${index}].${key}`, message: `"${name}" is used twice.` }],
  );
}

/**
 * The refIds a view reads, with their paths inside the view.
 *
 * @param view - The view.
 * @returns Pairs of path and refId.
 */
function viewRefs(view: View): [string, string][] {
  if (view.kind === 'chart') {
    return view.datasets.map((dataset, index) => [`datasets[${index}].ref`, dataset.ref]);
  }
  const refs: [string, string][] = [['ref', view.ref]];
  if (view.kind === 'stat' && view.compare) refs.push(['compare.ref', view.compare.ref]);
  return refs;
}

/**
 * Checks one panel: unique refIds, a view bound to them, and markers bound to annotations.
 *
 * @param panel - The panel.
 * @param path - Its path, such as `panels[2]`.
 * @param annotations - The ids of the dashboard's annotations.
 * @returns The issues.
 */
function checkPanel(panel: Panel, path: string, annotations: ReadonlySet<string>): SpecIssue[] {
  const refIds = panel.queries.map((query) => query.refId);
  const issues = duplicates(refIds, `${path}.queries`, 'refId');
  for (const [refPath, ref] of viewRefs(panel.view)) {
    if (!refIds.includes(ref))
      issues.push({ path: `${path}.view.${refPath}`, message: `Unknown refId "${ref}".` });
  }
  const markers = panel.view.kind === 'chart' ? (panel.view.markers ?? []) : [];
  markers.forEach((marker, index) => {
    if (!annotations.has(marker.annotation))
      issues.push({
        path: `${path}.view.markers[${index}].annotation`,
        message: `Unknown annotation "${marker.annotation}".`,
      });
  });
  return issues;
}

/**
 * Checks a variable's default against its declaration.
 *
 * @param variable - The variable.
 * @param path - Its path, such as `variables[0]`.
 * @returns The issues.
 */
function checkVariable(variable: Variable, path: string): SpecIssue[] {
  if (variable.kind === 'text') return checkText(variable, path);
  const defaults = variable.default === undefined ? [] : [variable.default].flat();
  if (!isMultiValue(variable) && defaults.length > 1)
    return [
      { path: `${path}.default`, message: 'Only a multi-value variable has several defaults.' },
    ];
  if (variable.kind === 'query') return [];
  const unknown = defaults.find((value) => !variable.options.includes(value));
  return unknown === undefined
    ? []
    : [{ path: `${path}.default`, message: `"${unknown}" is not one of the options.` }];
}

/**
 * Checks a text variable's pattern compiles, cannot backtrack for long, and matches its default.
 *
 * @param pattern - The pattern, if any.
 * @param value - The default.
 * @param path - The variable's path.
 * @returns The issues.
 */
function checkPattern(pattern: string | undefined, value: string, path: string): SpecIssue[] {
  if (pattern === undefined) return [];
  try {
    new RegExp(pattern);
  } catch {
    return [{ path: `${path}.pattern`, message: 'The pattern is not a valid regular expression.' }];
  }
  const slow = slowPattern(pattern);
  if (slow) return [{ path: `${path}.pattern`, message: slow }];
  return new RegExp(`^(?:${pattern})$`).test(value)
    ? []
    : [{ path: `${path}.default`, message: 'The default does not match the pattern.' }];
}

/**
 * Checks a text variable: its default's length, then its pattern.
 *
 * @param variable - The variable.
 * @param path - Its path, such as `variables[0]`.
 * @returns The issues.
 */
function checkText(variable: Extract<Variable, { kind: 'text' }>, path: string): SpecIssue[] {
  if (variable.default.length > maxTextValueLength)
    return [
      {
        path: `${path}.default`,
        message: `A text value is at most ${maxTextValueLength} characters.`,
      },
    ];
  return checkPattern(variable.pattern, variable.default, path);
}

/**
 * Checks the names and references of a spec.
 *
 * @param spec - A spec that passed the schema.
 * @returns The issues.
 */
export function checkReferences(spec: DashboardSpec): SpecIssue[] {
  const annotations = new Set(spec.annotations.map((annotation) => annotation.id));
  return [
    ...duplicates(
      spec.panels.map((panel) => panel.id),
      'panels',
      'id',
    ),
    ...duplicates(
      spec.annotations.map((annotation) => annotation.id),
      'annotations',
      'id',
    ),
    ...duplicates(
      spec.variables.map((variable) => variable.name),
      'variables',
      'name',
    ),
    ...spec.variables.flatMap((variable, index) => checkVariable(variable, `variables[${index}]`)),
    ...spec.panels.flatMap((panel, index) => checkPanel(panel, `panels[${index}]`, annotations)),
  ];
}
