/**
 * How to get each shape of data from Loki, for the agent. It is about data, not charts: any chart
 * recipe for the shape can draw the result.
 */

/** The guide. */
export const lokiGuide = `Loki (LogQL). Select streams by label, {service="$service"}, then filter lines (|= "text", |~ "regex") and parse fields (| json, | logfmt) to filter or group on them (| level="error"). Variables go only inside quoted values; $__interval, $__range and interval variables go where a duration does. No line_format or label_format.
- rows (log lines): {service="checkout-svc"} | json | level="error". The result is a table of time, line and a column per label, newest first.
- long over time: sum by (level) (count_over_time({service="checkout-svc"} | json [$__interval])). One series per level; the step follows the time range.
- rate: sum by (service) (rate({env="prod"} |= "timeout" [$__rate_interval])).
- numbers from lines: avg_over_time({service="checkout-svc"} | json | unwrap duration_ms [$__interval]), or quantile_over_time(0.95, … | unwrap duration_ms [$__interval]) by (route).
- long by category or single: add "instant": true, such as sum by (route) (count_over_time({service="checkout-svc"} | json | status >= 500 [$__range])).`;
