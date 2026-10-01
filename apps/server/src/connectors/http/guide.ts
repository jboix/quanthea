/**
 * How to get data from a JSON API, for the agent. It is about data, not charts: any chart recipe
 * for the shape can draw the result.
 */

/** The guide. */
export const httpGuide = `HTTP JSON. The catalog lists the operations the connector allows, such as "GET /api/v1/deploys", with their parameters and the fields of their rows. A query is { "method": "GET", "path": "/api/v1/services/$service/errors", "query": { "from": "$__from", "to": "$__to" }, "extract": { "rows": "/data", "fields": [...] } }.
- $name goes in the path (one value) and in query values; a query value that is a multi-value variable alone repeats. $__from and $__to are ISO times, $__from_ms and $__from_s epoch numbers (and the same for __to). A POST body takes {"$var": "name"} nodes.
- extract.rows is a JSON pointer to the array of rows ("" for a top-level array; the catalog says "Rows at /data" when they are nested).
- Without fields, every value of the rows becomes a column, nested ones as dotted names, typed from the values; ISO dates become times. Name fields to pick, rename or type columns: { "name": "time", "pointer": "/t", "type": "time", "unit": "s" } for epoch seconds.
- The API decides the shapes: long over time needs a time column, a series column and a value; ask for the rows the chart needs and name the columns accordingly.`;
