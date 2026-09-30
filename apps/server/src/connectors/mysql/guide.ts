/**
 * How to get each shape of data from MySQL and MariaDB, for the agent. It is about data, not charts:
 * any chart recipe for the shape can draw the result.
 */

/** The guide. */
export const mysqlGuide = `MySQL and MariaDB (SQL). Bind the range with :__from and :__to and variables with :name; never paste values. Alias every column, each name once, so roles can name it. Quote names with backticks. The session is in UTC.
- long over time: SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(created_at) / 300) * 300) AS time, CAST(status AS CHAR) AS series, count(*) AS value … GROUP BY 1, 2 ORDER BY 1. The sql-series builder writes this.
- long by category: SELECT CAST(region AS CHAR) AS region, sum(total) AS value … GROUP BY 1 ORDER BY 2 DESC LIMIT 20. The sql-breakdown builder writes this.
- wide: one column per measure: SELECT DATE(t) AS time, sum(a) AS alpha, sum(b) AS beta … GROUP BY 1.
- single: SELECT count(*) AS value …, or several named measures in one row. The sql-stat builder writes this.
- values: the raw numbers, sampled when large: SELECT duration_ms AS value, endpoint AS \`group\` … ORDER BY RAND() LIMIT 2000.
- matrix: SELECT DAYNAME(t) AS weekday, HOUR(t) AS hour, count(*) AS value … GROUP BY 1, 2.
- hierarchical: one row per leaf with a column per level: SELECT department, team, sum(budget) AS value … GROUP BY 1, 2.
- graph: one row per link: SELECT from_page AS source, to_page AS target, count(*) AS value … GROUP BY 1, 2.
- geo: SELECT country AS region, count(*) AS value … (English country names), or latitude, longitude and a value.
- ohlc: first and last per bucket with FIRST_VALUE and LAST_VALUE window functions, min and max with MIN and MAX.
- rows: SELECT the columns people read … ORDER BY time DESC LIMIT 100. The sql-rows builder writes this.`;
