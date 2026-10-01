/**
 * How to get each shape of data from Elasticsearch and OpenSearch, for the agent. It is about
 * data, not charts: any chart recipe for the shape can draw the result.
 */

/**
 * The guide of one product.
 *
 * @param product - `Elasticsearch` or `OpenSearch`.
 * @returns The guide.
 */
export function searchGuide(product: string): string {
  return `${product} (search DSL). A query is an index or pattern ("logs-*") and a JSON body. A variable is a node of its own, {"$var": "service"}: a string, or a list for a multi-value variable (use terms then). Filter the time with {"range": {"@timestamp": {"gte": {"$var": "__from"}, "lte": {"$var": "__to"}}}}. No scripts or runtime fields.
- With aggs, the result is one table: a column per bucket aggregation, nested level by level, and a column per metric of the deepest level, or "count" when it has none. Never put two bucket aggregations side by side; nest them.
- long over time: {"size": 0, "query": …, "aggs": {"time": {"date_histogram": {"field": "@timestamp", "fixed_interval": {"$var": "__interval"}}, "aggs": {"series": {"terms": {"field": "level", "size": 10}}}}}} gives time, series, count. Add a metric under the deepest level, such as "value": {"avg": {"field": "duration_ms"}}.
- long by category: {"aggs": {"service": {"terms": {"field": "service", "size": 20}, "aggs": {"value": {"sum": {"field": "bytes"}}}}}}.
- single: {"aggs": {"value": {"value_count": {"field": "trace_id"}}}}, or several metrics side by side.
- percentiles: {"percentiles": {"field": "duration_ms", "percents": [50, 95, 99]}} gives one column per percentile, "name p95".
- matrix: nest a terms or histogram under another.
- rows: no aggs; "size" up to 100, "sort": [{"@timestamp": "desc"}], "_source": ["@timestamp", "level", "message"]. Nested fields become dotted columns.
- Aggregate on keyword fields (or text.keyword), not text fields.`;
}
