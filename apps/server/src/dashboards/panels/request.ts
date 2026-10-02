/**
 * What the agent asks for, instead of writing a spec: panels, each a data request and a chart
 * recipe, and the dashboard's variables, time range and sets of markers. This is the edit tool's
 * input schema, so providers that constrain tool input keep the model to it.
 */
import {
  chartRecipes,
  chartUnits,
  markerColors,
  timeRangeSchema,
  variableSchema,
} from '@quanthea/shared';
import { z } from 'zod';
import {
  type AvailableQueries,
  connectorSchema,
  dataSchema,
  dataSchemaFor,
  filtersSchema,
  nameSchema,
  rawDataSchema,
  tableSchema,
} from '../queries/index.ts';

/** How wide a panel is. */
const widthSchema = z.enum(['quarter', 'third', 'half', 'full']);

/** A panel width. */
export type Width = z.output<typeof widthSchema>;

/** Every chart recipe's id, the first apart for Zod's enum. */
const [firstId = 'trend.line', ...otherIds] = chartRecipes.map((recipe) => recipe.id);

/**
 * The chart of a panel: a recipe, its variants, the columns of its roles, the unit, and changes to
 * its option.
 *
 * @param recipes - The recipes the run may use.
 * @returns The schema.
 */
function chartSchemaWith(recipes: readonly [string, ...string[]]) {
  return z.strictObject({
    recipe: z.enum(recipes),
    variants: z.array(z.string().max(40)).max(4).default([]),
    roles: z
      .record(
        z.string().max(20),
        z.union([z.string().max(200), z.array(z.string().max(200)).max(20)]),
      )
      .optional(),
    unit: z.enum(chartUnits).optional(),
    // Not z.json(): its recursive schema is refused by Gemini. The spec check validates the values.
    options: z.record(z.string(), z.unknown()).optional(),
  });
}

/**
 * A panel: what data, and how it is drawn.
 *
 * @param data - The data schema.
 * @param chart - The chart schema.
 * @returns The schema.
 */
function panelSchemaWith<Data extends z.ZodType, Chart extends z.ZodType>(
  data: Data,
  chart: Chart,
) {
  return z.strictObject({
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    width: widthSchema.optional(),
    replaces: z.string().max(63).optional(),
    data,
    chart,
  });
}

/** The panels that show a set of markers, by id or title; every time chart when left out. */
const markedPanelsSchema = z.array(z.string().max(200)).max(20).optional();

/**
 * The id of a set of markers, a slug such as `deploys`, which a later edit names to change it. The
 * slug is checked in code (markers.ts), to keep patterns out of the tool's schema.
 */
const markerIdSchema = z.string().min(1).max(40);

/** What every set of markers has: its id, label, colour and charts. */
const markerSetFields = {
  id: markerIdSchema,
  label: z.string().min(1).max(60),
  color: z.enum(markerColors).optional(),
  panels: markedPanelsSchema,
};

/** Markers from a table of a SQL connector: the time and text columns of its rows. */
const tableMarkersSchema = z.strictObject({
  ...markerSetFields,
  connector: connectorSchema,
  table: tableSchema,
  time: nameSchema,
  text: nameSchema,
  filters: filtersSchema,
});

/** Markers from a raw query in any language, which returns a time and a text column. */
const queryMarkersSchema = z.strictObject({
  ...markerSetFields,
  data: rawDataSchema,
  time: nameSchema.default('time'),
  text: nameSchema.default('text'),
});

/** A set of markers: events drawn as lines on time charts, from a table or from a query. */
const markersSchema = z.union([queryMarkersSchema, tableMarkersSchema]);

/**
 * The edit's fields around its panels.
 *
 * @param panels - The schema of one panel.
 * @returns The edit's schema.
 */
function editSchemaWith<Panel extends z.ZodType>(panels: Panel) {
  return z.strictObject({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    time: timeRangeSchema.optional(),
    variables: z.array(variableSchema).max(20).optional(),
    panels: z.array(panels).max(20).default([]),
    remove: z.array(z.string()).max(20).default([]),
    markers: z.array(markersSchema).max(10).default([]),
    removeMarkers: z.array(z.string().max(63)).max(10).default([]),
    summary: z.string().min(1).max(200),
  });
}

/**
 * The edit schema of a run: only the query builders, saved queries and chart recipes it may use.
 *
 * @param available - The builders and saved queries.
 * @param recipes - The chart recipes; every one by default.
 * @returns The schema. Its output is an {@link EditRequest}.
 */
export function editRequestSchemaFor(
  available: AvailableQueries,
  recipes: readonly string[] = [firstId, ...otherIds],
) {
  const [first = firstId, ...rest] = recipes;
  return editSchemaWith(
    panelSchemaWith(dataSchemaFor(available), chartSchemaWith([first, ...rest])),
  );
}

/** Validates an edit with any builder and any chart recipe. */
export const editRequestSchema = editSchemaWith(
  panelSchemaWith(dataSchema, chartSchemaWith([firstId, ...otherIds])),
);

/** An edit. */
export type EditRequest = z.output<typeof editRequestSchema>;

/** One panel of an edit. */
export type PanelRequest = EditRequest['panels'][number];

/** One set of markers an edit adds or replaces. */
export type MarkersRequest = z.output<typeof markersSchema>;
