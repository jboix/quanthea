/** What building a data request gives: the queries, and the table they return. */
import type { ChartUnit, PanelQuery, SavedQuery, ShapeKind } from '@querent/shared';
import type { SqlFlavor } from '../../query/sql-dialects.ts';

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

/** What building needs beyond the request: the saved queries, and each connector's dialect. */
export interface BuildContext {
  /** The saved queries the run may use. */
  readonly saved: readonly SavedQuery[];
  /**
   * The SQL dialect of a connector, so SQL is written for it.
   *
   * @param connector - The connector name.
   * @returns Its dialect, or `undefined` when it is unknown or runs no SQL: PostgreSQL is written.
   */
  readonly dialectOf?: ((connector: string) => SqlFlavor | undefined) | undefined;
}
