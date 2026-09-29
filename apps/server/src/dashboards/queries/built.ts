/** What building a data request gives: the queries, and the table they return. */
import type { ChartUnit, PanelQuery, ShapeKind } from '@querent/shared';

/** The table a data request returns, and a chart that suits it. */
export interface DataOutput {
  /** Its shape. */
  readonly shape: ShapeKind;
  /** Its columns, in order; empty when only running the query tells, as for raw queries. */
  readonly columns: readonly string[];
  /** A chart recipe that suits it, for previews and as a hint. */
  readonly chart: string;
  /** The unit its values usually have. */
  readonly unit?: ChartUnit;
}

/** A built data request. */
export interface BuiltData {
  /** The queries, refId A first. */
  readonly queries: PanelQuery[];
  /** What they return. */
  readonly output: DataOutput;
}
