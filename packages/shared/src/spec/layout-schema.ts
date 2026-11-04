/**
 * The shape of a layout: where each panel of one version of a dashboard or a report sits, how big
 * it is, whether it is hidden and, on a dashboard, which section holds it.
 */
import { z } from 'zod';
import { maxSections, type Panel, panelGridSchema } from './dashboard.ts';
import { slugSchema } from './names.ts';

/** A panel's place on the grid. */
export type PanelGrid = Panel['grid'];

/** Validates one panel's entry in a layout. */
const layoutPanelSchema = z.strictObject({
  id: slugSchema,
  grid: panelGridSchema,
  hidden: z.boolean(),
  /** The section that holds it, when the layout sets the sections; none when left out. */
  section: slugSchema.optional(),
});

/** Validates a section as a layout sets it: its id and its title. */
const layoutSectionSchema = z.strictObject({
  id: slugSchema,
  title: z.string().trim().min(1).max(100),
});

/** Validates a layout: one entry per panel of the version. */
export const dashboardLayoutSchema = z.strictObject({
  panels: z.array(layoutPanelSchema).max(60),
  /**
   * The sections of a dashboard, in order, with their titles. Set, they replace the spec's, and
   * each panel's `section` says where it sits. Left out, the spec's sections show.
   */
  sections: z.array(layoutSectionSchema).max(maxSections).optional(),
});

/** A layout. */
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/** One panel's entry in a layout. */
export type LayoutPanel = DashboardLayout['panels'][number];

/** One section as a layout sets it. */
export type LayoutSection = NonNullable<DashboardLayout['sections']>[number];
