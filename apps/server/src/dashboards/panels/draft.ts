/** A panel as its request expands, before it gets an id and a place on the grid. */
import type { PanelQuery, View } from '@quanthea/shared';
import type { Width } from './request.ts';

/** What a panel shows, which decides its size and whether deploy markers go on it. */
export type PanelShape = 'stat' | 'time' | 'chart' | 'table';

/** A panel before it gets an id and a place on the grid. */
export interface PanelDraft {
  /** The title. */
  readonly title: string;
  /** The description, if any. */
  readonly description?: string;
  /** The queries. */
  readonly queries: PanelQuery[];
  /** The view. */
  readonly view: View;
  /** What it shows. */
  readonly shape: PanelShape;
  /** The width asked for, if any. */
  readonly width: Width | undefined;
}
