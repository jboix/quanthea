/**
 * The guide to a panel's table operations, which the agent reads with read_guide before it writes
 * any. The panel guide carries one line that points at it, to keep every run's instructions small.
 */

/** The line of the panel guide about operations. */
export const operationsLine =
  '"operations"?: server steps on the panel\'s table when the query cannot compute it, such as a ratio of two columns or a join with "more" data. Read read_guide: { "kind": "operations" } first.';

/** The guide to table operations. */
export const operationsGuide = `Table operations: "operations" on a panel, a list of steps the server runs in order on the table of its first data request. The table they end with keeps refId A, so roles and table columns name its columns. Use them only when the query cannot compute the result: a builder, or the source's own language, comes first.
- {"op": "calculate", "name": "rate", "fn": "ratio", "of": ["errors", "sessions"]}: a new number column from two number columns, a then b. ratio is a / b and complement 1 - a / b, both 0 where b is 0; difference a - b; sum a + b; product a × b. A missing value on either side gives none. A column of the same name is replaced.
- "more": up to three further data requests of the panel, each raw or saved, on any connector. They get refIds B, C and D in order, and only join and append read them.
- {"op": "join", "with": "B", "on": ["time"], "how": "outer", "rename": {"value": "sessions"}}: B's table joined on key columns both tables have, its other columns added. "how" is "outer" (every key of either side, no value where a side has none) or "inner" (keys both have). "rename" renames B's columns first: two columns of the same name are refused.
- {"op": "append", "with": "B", "rename": {"application": "origin"}}: B's rows added under the table's, columns matched by name after the rename. A column one side lacks has no value in that side's rows.
- {"op": "pivot", "rows": "error_type", "columns": "version", "value": "count"}: a row per value of "rows", a column per value of "columns" in natural order (2.10 after 2.9), at most 50, and in each cell the sum of "value", 0 where there is none. Its columns are named by data: a table lists "rows" in roles.columns, and options.rest: { "format"?, "align"?, "mappings"?, "toneAs"?, "width"? } styles every column it does not list.
- {"op": "concat", "name": "os", "columns": ["os_name", "os_version"], "separator": " "}: a text column joined from 2 to 4 columns, such as "iOS 18.5"; a missing value is left out.
- {"op": "sort", "by": "version", "descending": false}: the rows by a column, numbers by value and text in natural order (2.10 after 2.9), missing values last. Sort in the query when it can.
Join a share over time: the counts as "data", the whole as "more" B, join on "time", then calculate the ratio.
A step that cannot run fails the panel with a message naming the step and the table's columns: fix the step or the query.`;

/** The guide to table operations, under the name the panel guide gives it. */
export const operationsTopic = { kind: 'operations', text: operationsGuide };
