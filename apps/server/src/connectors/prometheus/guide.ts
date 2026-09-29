/**
 * How to get each shape of data from Prometheus, for the agent. It is about data, not charts: any
 * chart recipe for the shape can draw the result.
 */

/** The guide. */
export const prometheusGuide = `Prometheus (PromQL). A range query returns a long table: time, one column per label kept by "by", a series column naming each series, and value. An instant query (instant: true) returns one row per series: its labels and Value. Use $name only inside label matchers, and $__rate_interval, $__interval, $__range or an interval variable where a duration goes.
- long over time: sum by (code) (rate(http_requests_total[$__rate_interval])). The rate, ratio, latency and gauge builders write these.
- long by category: an instant topk(10, sum by (path) (increase(x[$__range]))). The top builder writes this.
- single: an instant query with no "by", such as sum(up).
- wide: several series with no label to split by; prefer long, which charts pivot.
- matrix: an instant query by two labels: sum by (service, code) (increase(x[$__range])).
- hierarchical: an instant query by two or three labels, the levels from the top down.
- values: histogram buckets are already binned; use the latency builder, or a heatmap of rate by le.
- geo, graph and ohlc: Prometheus rarely holds these; say so rather than force them.`;
