/**
 * How to get each shape of data from ClickHouse, for the agent. It is about data, not charts: any
 * chart recipe for the shape can draw the result.
 */

/** The guide. */
export const clickhouseGuide = `ClickHouse (SQL). Bind the range with :__from and :__to and variables with :name; never paste values. A variable is a String: compare it to a column directly, or convert it (toUInt32(:n)). Alias every column, each name once, so roles can name it. Quote names with backticks. Times are in UTC. No SETTINGS or FORMAT clause.
- long over time: SELECT toStartOfInterval(created_at, INTERVAL 5 MINUTE) AS time, toString(status) AS series, count() AS value … GROUP BY time, series ORDER BY time. The sql-series builder writes this.
- long by category: SELECT toString(region) AS region, sum(total) AS value … GROUP BY region ORDER BY value DESC LIMIT 20. The sql-breakdown builder writes this.
- wide: one column per measure: SELECT toStartOfDay(t) AS time, sumIf(amount, kind = 'a') AS alpha, sumIf(amount, kind = 'b') AS beta … GROUP BY time.
- single: SELECT count() AS value …, or several named measures in one row. The sql-stat builder writes this.
- values: the raw numbers, sampled when large: SELECT duration_ms AS value, endpoint AS \`group\` … ORDER BY rand() LIMIT 2000.
- matrix: SELECT toDayOfWeek(t) AS weekday, toHour(t) AS hour, count() AS value … GROUP BY weekday, hour.
- hierarchical: one row per leaf with a column per level: SELECT department, team, sum(budget) AS value … GROUP BY department, team.
- graph: one row per link: SELECT from_page AS source, to_page AS target, count() AS value … GROUP BY source, target.
- geo: SELECT country AS region, count() AS value … (English country names), or latitude, longitude and a value.
- ohlc: argMin(price, t) AS open, max(price) AS high, min(price) AS low, argMax(price, t) AS close per bucket.
- percentiles: quantiles(0.5, 0.9, 0.99)(duration_ms) returns an array; prefer quantile(0.9)(duration_ms) AS p90, one column each.
- rows: SELECT the columns people read … ORDER BY time DESC LIMIT 100. The sql-rows builder writes this.`;
