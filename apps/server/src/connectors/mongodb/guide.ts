/**
 * How to get data from MongoDB, for the agent. It is about data, not charts: any chart recipe for
 * the shape can draw the result.
 */

/** The guide. */
export const mongodbGuide = `MongoDB (one aggregation pipeline per query). The catalog lists collections with the fields of sampled documents, nested ones as dotted names. A query is a collection and a pipeline in Extended JSON; a variable is a node {"$var": "name"} ({"$var": "name", "as": "list"} for $in), __from and __to are dates and __interval_ms a bucket width. Each result document is a row, nested fields become dotted columns, so name the output fields with $project.
- over time: $match the time field between __from and __to, $group by {"$dateTrunc": {"date": "$created_at", "unit": "millisecond", "binSize": {"$var": "__interval_ms"}}}, or {"$var": "interval", "as": "ms"} for an interval variable, $sort by _id.
- long by category (ranking): $group by the category with $sum or $avg, $sort, $limit.
- single: $match then $count, or $group with _id null.
- rows: $match, $sort, $limit, $project the fields to show.
- Bound every query: $match on time or $limit, never the whole collection.`;
