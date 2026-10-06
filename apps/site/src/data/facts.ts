/**
 * The product facts the website states: the sources quanthea reads, where it sends notifications,
 * which models and sign-in providers it supports, which charts it draws, and its roles. The
 * identifiers come from `@quanthea/shared` where it has them; `facts.test.ts` checks the rest
 * against the server's registries, so the site cannot drift from the code.
 */
import {
  type ChannelKind,
  channelKinds,
  type ModelProvider,
  modelProviders,
  type ProviderKind,
  providerKinds,
  type Role,
  roles,
} from '@quanthea/shared';

/** A data source quanthea reads. */
export interface ConnectorFact {
  /** The name people know it by. */
  readonly name: string;
  /** The connector kind that reads it, in `apps/server/src/connectors/`. */
  readonly kind: string;
}

/**
 * The data sources, as the site lists them. TimescaleDB is read by the Postgres connector; the
 * other sources have a kind of their own.
 */
export const connectors: readonly ConnectorFact[] = [
  { name: 'Prometheus', kind: 'prometheus' },
  { name: 'Loki', kind: 'loki' },
  { name: 'InfluxDB', kind: 'influxdb' },
  { name: 'PostgreSQL', kind: 'postgres' },
  { name: 'TimescaleDB', kind: 'postgres' },
  { name: 'MySQL', kind: 'mysql' },
  { name: 'MariaDB', kind: 'mariadb' },
  { name: 'ClickHouse', kind: 'clickhouse' },
  { name: 'Trino', kind: 'trino' },
  { name: 'Elasticsearch', kind: 'elasticsearch' },
  { name: 'OpenSearch', kind: 'opensearch' },
  { name: 'Valkey', kind: 'valkey' },
  { name: 'MongoDB', kind: 'mongodb' },
  { name: 'HTTP APIs', kind: 'http' },
];

/** The display name of each notification channel kind. */
const channelNames: Readonly<Record<ChannelKind, string>> = {
  webhook: 'Webhook',
  slack: 'Slack',
  discord: 'Discord',
  teams: 'Microsoft Teams',
  pagerduty: 'PagerDuty',
};

/** The notification channels, in the order the app lists them. */
export const notificationChannels: readonly { kind: ChannelKind; name: string }[] =
  channelKinds.map((kind) => ({ kind, name: channelNames[kind] }));

/** The display name of each model provider. */
const modelProviderNames: Readonly<Record<ModelProvider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  'openai-compatible': 'OpenAI-compatible',
};

/**
 * The model providers. Gemini and local models work through an OpenAI-compatible endpoint; the
 * demo uses Gemini that way.
 */
export const modelProviderFacts: readonly { id: ModelProvider; name: string }[] =
  modelProviders.map((id) => ({ id, name: modelProviderNames[id] }));

/** The display name of each identity provider kind. */
const signInProviderNames: Readonly<Record<ProviderKind, string>> = {
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
  entra: 'Microsoft Entra',
};

/** The ways to sign in: each identity provider kind, then a password. */
export const signInProviders: readonly string[] = [
  ...providerKinds.map((kind) => signInProviderNames[kind]),
  'Password',
];

/** A series type a chart may draw. */
export interface SeriesTypeFact {
  /** The ECharts series type, as the spec writes it. */
  readonly type: string;
  /** The name people know it by. */
  readonly name: string;
}

/** The series types of the dashboard spec, in the spec's order. */
export const seriesTypes: readonly SeriesTypeFact[] = [
  { type: 'line', name: 'Line' },
  { type: 'bar', name: 'Bar' },
  { type: 'scatter', name: 'Scatter' },
  { type: 'pie', name: 'Pie' },
  { type: 'heatmap', name: 'Heatmap' },
  { type: 'gauge', name: 'Gauge' },
  { type: 'boxplot', name: 'Box plot' },
  { type: 'candlestick', name: 'Candlestick' },
  { type: 'treemap', name: 'Treemap' },
  { type: 'sunburst', name: 'Sunburst' },
  { type: 'sankey', name: 'Sankey' },
  { type: 'graph', name: 'Graph' },
  { type: 'funnel', name: 'Funnel' },
  { type: 'radar', name: 'Radar' },
  { type: 'parallel', name: 'Parallel' },
  { type: 'map', name: 'Map' },
];

/** The panels besides charts. */
export const otherPanels: readonly string[] = ['Stat', 'Table'];

/** What each role may do, weakest first. */
const roleSummaries: Readonly<Record<Role, string>> = {
  viewer: 'Opens pinned dashboards.',
  analyst: 'Also asks questions about them.',
  editor: 'Also builds and pins dashboards.',
  admin: 'Also runs quanthea: connectors, people, settings.',
};

/** The roles, weakest first. */
export const roleFacts: readonly { role: Role; name: string; summary: string }[] = roles.map(
  (role) => ({
    role,
    name: role.charAt(0).toUpperCase() + role.slice(1),
    summary: roleSummaries[role],
  }),
);
