/**
 * The families of panels the parity questions cover. A family is one kind of panel a team asks
 * for on its player events: what the data is, and how it is shown. Each has one question.
 */

/** One family of panels. */
export interface ParityFamily {
  /** Its id, `f01` to `f33`: a later change names the families it should turn green. */
  readonly id: string;
  /** What a panel of the family is. */
  readonly what: string;
}

/** The families, in the order their questions run. */
export const parityFamilies: readonly ParityFamily[] = [
  { id: 'f01', what: 'a count over time, split by a field' },
  { id: 'f02', what: 'a percentile over time' },
  { id: 'f03', what: 'a ratio over time' },
  { id: 'f04', what: 'the top values of a field as a donut' },
  { id: 'f05', what: 'a donut with one slice for the rest' },
  { id: 'f06', what: 'one number' },
  { id: 'f07', what: 'a stat coloured by steps' },
  { id: 'f08', what: 'a gauge with steps' },
  { id: 'f09', what: 'sessions started against distinct sessions' },
  { id: 'f10', what: 'a table with a column coloured by steps' },
  { id: 'f11', what: 'a table by two keys with errors, sessions and their ratio, worst first' },
  { id: 'f12', what: 'a breakdown by named groups, each with its own filter' },
  { id: 'f13', what: 'four named groups over time as stacked bars' },
  { id: 'f14', what: 'the latest errors as rows, oldest first' },
  { id: 'f15', what: 'a range filter on a timing and a list filter' },
  { id: 'f16', what: 'errors by type over all sessions, over time' },
  { id: 'f17', what: 'web and mobile applications in one table' },
  { id: 'f18', what: 'a matrix table with cells coloured by steps' },
  { id: 'f19', what: 'two columns joined into one text' },
  { id: 'f20', what: 'the share of each major version as bars, in version order' },
  { id: 'f21', what: 'a histogram of a timing that stops at a percentile' },
  { id: 'f22', what: 'a list read by a query filters another panel' },
  { id: 'f23', what: 'titles from an HTTP API beside counts' },
  { id: 'f24', what: 'a table whose rows link to another dashboard' },
  { id: 'f25', what: 'a table with thumbnails' },
  { id: 'f26', what: 'one session as a record of labelled values' },
  { id: 'f27', what: 'a row of stats, one per value of a field' },
  { id: 'f28', what: 'the latest errors as logs' },
  { id: 'f29', what: 'a section repeated for each value of a variable' },
  { id: 'f30', what: 'a legend with a total per series' },
  { id: 'f31', what: 'the same colour per value on two panels' },
  { id: 'f32', what: 'a long range with a split' },
  { id: 'f33', what: 'a question that tempts a raw query' },
];
