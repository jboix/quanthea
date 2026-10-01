/**
 * How to get each shape of data from InfluxDB 3, for the agent. It is about data, not charts: any
 * chart recipe for the shape can draw the result.
 */

/** The guide. */
export const influxdbGuide = `InfluxDB 3 (SQL, as in PostgreSQL). A table is a measurement: its tags are text, its fields numbers, and "time" its timestamp, in UTC. Always bound time: WHERE time BETWEEN :__from AND :__to. Variables are text: cast before comparing with a number (requests > CAST(:min AS BIGINT)). Alias every column. Quote names with double quotes.
- long over time: SELECT date_bin(INTERVAL '5 minutes', time, :__from) AS time, service AS series, sum(errors) AS value … GROUP BY 1, 2 ORDER BY 1. The sql-series builder writes this.
- long by category: SELECT service, sum(requests) AS value … GROUP BY 1 ORDER BY 2 DESC. The sql-breakdown builder writes this.
- single: SELECT sum(errors) / sum(requests) AS value …. The sql-stat builder writes this.
- percentiles: approx_percentile_cont(p95_ms, 0.95) AS p95.
- rows: SELECT time, service, errors … ORDER BY time DESC LIMIT 100. The sql-rows builder writes this.`;
