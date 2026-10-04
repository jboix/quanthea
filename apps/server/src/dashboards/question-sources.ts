/**
 * The sources a dashboard version reads, by name and access level only, so the Ask tab can say
 * when an answer can only explain.
 */
import type { DashboardSource, DashboardSpec } from '@quanthea/shared';

/**
 * The connectors a spec names: in its panels, its markers and its query-backed variables.
 *
 * @param spec - The spec.
 * @returns The names, in order of first use.
 */
function connectorNamesOf(spec: DashboardSpec): string[] {
  return [
    ...new Set([
      ...spec.panels.flatMap((panel) => panel.queries.map((query) => query.connector)),
      ...spec.annotations.map((annotation) => annotation.query.connector),
      ...spec.variables.flatMap((variable) =>
        variable.kind === 'query' ? [variable.source.connector] : [],
      ),
    ]),
  ];
}

/**
 * The sources of a spec with their access levels.
 *
 * @param connectorLevels - The configured connectors' names and access levels.
 * @param spec - The spec.
 * @returns The sources.
 */
export function sourcesOf(
  connectorLevels: () => readonly { name: string; accessLevel: number }[],
  spec: DashboardSpec,
): DashboardSource[] {
  const levels = new Map(connectorLevels().map((each) => [each.name, each.accessLevel]));
  return connectorNamesOf(spec).map((name) => {
    const level = levels.get(name);
    const accessLevel = level === 1 || level === 2 || level === 3 || level === 4 ? level : null;
    return { name, accessLevel };
  });
}
