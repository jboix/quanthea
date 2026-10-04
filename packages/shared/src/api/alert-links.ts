/**
 * Links between alerts and dashboard panels. A link names an alert and a panel by id, so it
 * follows the panel from version to version. Links are made from a panel, from the agent's card,
 * by hand, or from a suggestion when the alert's query and the panel's match; never on their own.
 */
import { z } from 'zod';
import { namedFormatterSchema } from '../formatters/schema.ts';
import { timeExpressionSchema } from '../spec/time.ts';
import { alertStates } from './alerts.ts';
import { defineEndpoint } from './contract.ts';

/** How a link was made: from the panel, from the agent's card, by hand, or from a match. */
export const alertLinkHows = ['from_panel', 'agent', 'by_hand', 'query_match'] as const;

/** How a link was made. */
export type AlertLinkHow = (typeof alertLinkHows)[number];

/** Validates a series' labels. */
const labelsSchema = z.record(z.string(), z.string());

/** Validates an id in a path or a body. */
const idSchema = z.string().min(1).max(64);

/** Validates a panel an alert is shown on, as the alert page lists it. */
const shownOnSchema = z.object({
  dashboardId: z.string(),
  dashboardTitle: z.string(),
  panelId: z.string(),
  /** The panel's title on the version shown; `null` when that version has no such panel. */
  panelTitle: z.string().nullable(),
  /** The version shown: the pinned one, else the latest for editors. */
  version: z.int(),
  /** Whether the dashboard is pinned. */
  pinned: z.boolean(),
  how: z.enum(alertLinkHows),
  createdAt: z.number(),
});

/** A panel an alert is shown on. */
export type ShownOn = z.infer<typeof shownOnSchema>;

/** Validates a panel of a pinned version whose query matches the alert's, not linked yet. */
const linkSuggestionSchema = z.object({
  dashboardId: z.string(),
  dashboardTitle: z.string(),
  panelId: z.string(),
  panelTitle: z.string(),
  version: z.int(),
});

/** A panel whose query matches the alert's. */
export type LinkSuggestion = z.infer<typeof linkSuggestionSchema>;

/** Validates where an alert is shown, and for editors the panels suggested and dismissed. */
export const alertLinksSchema = z.object({
  links: z.array(shownOnSchema),
  suggestions: z.array(linkSuggestionSchema),
  /** The panels whose suggestion an editor dismissed, or turned down from the agent's card. */
  dismissed: z.array(z.object({ dashboardId: z.string(), panelId: z.string() })),
});

/** Where an alert is shown, and the panels suggested. */
export type AlertLinks = z.infer<typeof alertLinksSchema>;

/** The path parameter of one alert. */
const alertParams = z.object({ alertId: idSchema });

/** Validates a panel of a dashboard, by id. */
const panelTargetSchema = z.object({ dashboardId: idSchema, panelId: z.string().min(1).max(64) });

/** Lists the panels an alert is shown on, and for editors the panels suggested. */
export const getAlertLinksEndpoint = defineEndpoint({
  method: 'GET',
  path: '/alerts/:alertId/links',
  params: alertParams,
  output: alertLinksSchema,
});

/** Links an alert to a panel of a pinned dashboard. A panel made from a thread links itself. */
export const linkAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/links',
  params: alertParams,
  body: panelTargetSchema.extend({ how: z.enum(['agent', 'by_hand', 'query_match']) }),
  output: alertLinksSchema,
});

/** Removes a link. */
export const unlinkAlertEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/alerts/:alertId/links/:dashboardId/:panelId',
  params: alertParams.extend(panelTargetSchema.shape),
  output: alertLinksSchema,
});

/** Dismisses a suggestion: it is not suggested again. */
export const dismissLinkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/link-dismissals',
  params: alertParams,
  body: panelTargetSchema,
  output: alertLinksSchema,
});

/** Validates a pinned dashboard with its panels, to pick one to link. */
const linkTargetSchema = z.object({
  dashboardId: z.string(),
  title: z.string(),
  version: z.int(),
  panels: z.array(z.object({ id: z.string(), title: z.string() })),
});

/** A pinned dashboard with its panels, to pick one to link. */
export type LinkTarget = z.infer<typeof linkTargetSchema>;

/** Lists the pinned dashboards and their panels, to link an alert to one. */
export const listLinkTargetsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/alert-link-targets',
  output: z.object({ dashboards: z.array(linkTargetSchema) }),
});

/** Validates an alert as a dashboard shows it on its linked panels. */
const panelAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Whether it is evaluated: active, and not deactivated. */
  evaluated: z.boolean(),
  muted: z.boolean(),
  /** The active version's threshold; `null` for a no-data condition or no active version. */
  threshold: z.object({ op: z.enum(['above', 'below']), value: z.number() }).nullable(),
  /** How the value reads. */
  format: namedFormatterSchema.nullable(),
  /** The fixed values of the active version's variables. */
  variables: z.array(
    z.object({ name: z.string(), value: z.union([z.string(), z.array(z.string())]) }),
  ),
  /** Each series' state now. */
  series: z.array(z.object({ labels: labelsSchema, state: z.enum(alertStates) })),
  /** When each series fired within the range; `to` is `null` while it still fires. */
  periods: z.array(z.object({ labels: labelsSchema, from: z.number(), to: z.number().nullable() })),
});

/** An alert as a dashboard shows it. */
export type PanelAlert = z.infer<typeof panelAlertSchema>;

/** Validates the alerts on a dashboard's panels. */
export const dashboardAlertsSchema = z.object({
  /** The alerts linked or suggested, each once. */
  alerts: z.array(panelAlertSchema),
  links: z.array(z.object({ alertId: z.string(), panelId: z.string() })),
  /** Alerts whose query matches a panel's, not linked: for editors only. */
  suggestions: z.array(z.object({ alertId: z.string(), panelId: z.string() })),
});

/** The alerts on a dashboard's panels. */
export type DashboardAlerts = z.infer<typeof dashboardAlertsSchema>;

/** Reads the alerts on a dashboard's panels, their state and firing periods over a range. */
export const getDashboardAlertsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/alerts',
  params: z.object({ dashboardId: idSchema }),
  query: z.object({
    from: timeExpressionSchema.default('now-6h'),
    to: timeExpressionSchema.default('now'),
  }),
  output: dashboardAlertsSchema,
});
