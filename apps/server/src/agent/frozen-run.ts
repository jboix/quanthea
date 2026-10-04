/** A report's run as the answering service reads it: its period and its frozen results. */
import type { PanelRun } from '@quanthea/shared';

/**
 * A report's run a question is about. Its results were computed by the server when it ran and are
 * frozen: the model reads them through the gate's access levels, and no query runs.
 */
export interface FrozenRun {
  /** The period's name, such as `week 40, 29 Sep – 5 Oct`. */
  readonly label: string;
  /** The period it compares with, with its name; `null` without one. */
  readonly comparison: {
    readonly from: number;
    readonly to: number;
    readonly label: string;
  } | null;
  /** Each panel's run over the period, by panel id. */
  readonly panels: Readonly<Record<string, PanelRun>>;
  /** Each panel's run over the comparison period; `null` without one. */
  readonly comparisonPanels: Readonly<Record<string, PanelRun>> | null;
}
