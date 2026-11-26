/**
 * What the MCP tools reach: the domain services they read, and the gate. Every piece of data a
 * tool returns comes out of the gate, shaped by the access level of the connector it was read
 * from. The tools never reach a connector, the query executor or the database.
 */
import type { AccessLevel } from '@quanthea/shared';
import type { Alerts } from '../alerts/alerts.ts';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type { Definitions } from '../dashboards/definitions.ts';
import type { ModelView } from '../gate/model-view.ts';
import type { Reports } from '../reports/reports.ts';

/** The services the MCP tools use. */
export interface McpServices {
  /** The dashboards. */
  readonly dashboards: Pick<Dashboards, 'get' | 'getVersion' | 'searchLibrary' | 'bindVariables'>;
  /** The connectors as a model sees them: the gate. */
  readonly modelView: Pick<
    ModelView,
    | 'connectors'
    | 'describe'
    | 'testQuery'
    | 'readOperations'
    | 'panelResult'
    | 'alertCheck'
    | 'accessOf'
  >;
  /** The definitions of business terms. */
  readonly definitions: Pick<Definitions, 'forModel'>;
  /** The alerts. */
  readonly alerts: Pick<Alerts, 'list' | 'get'>;
  /** The reports. */
  readonly reports: Pick<Reports, 'list' | 'runs' | 'run'>;
  /** quanthea's origin, when configured: links are paths without it. */
  readonly publicUrl: string | undefined;
  /** The clock; `Date.now` by default. */
  readonly now?: (() => number) | undefined;
}

/**
 * A link that opens something in quanthea.
 *
 * @param services - The MCP services.
 * @param segments - The path's segments, such as `d` and a dashboard id.
 * @returns The URL, or the path when quanthea has no public URL.
 */
export function linkTo(services: McpServices, ...segments: readonly string[]): string {
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${services.publicUrl ?? ''}/${path}`;
}

/**
 * The access level a connector's results are read at, for a result to say how it was shaped.
 *
 * @param services - The MCP services.
 * @param connector - The connector's name.
 * @returns The level, or `null` for a connector that no longer exists.
 */
export function levelOf(services: McpServices, connector: string): AccessLevel | null {
  return services.modelView.accessOf(connector)?.level ?? null;
}
