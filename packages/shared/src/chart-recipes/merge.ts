/**
 * Merges option patches: objects merge deeply, `null` removes a key, and a list of series merges
 * by position, while one series object applies to every series. Other lists are replaced.
 */

/** A JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A JSON object. */
export type JsonObject = { [key: string]: Json };

/**
 * Whether a value is a JSON object.
 *
 * @param value - The value.
 * @returns Whether it is an object that is not a list.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges a patch of the `series` key.
 *
 * @param base - The series before.
 * @param patch - The patch: a list merged by position, or one object for every series.
 * @returns The series after.
 */
function mergeSeries(base: Json | undefined, patch: Json): Json {
  const single = isJsonObject(base) ? [base] : [];
  const list = Array.isArray(base) ? base : single;
  if (isJsonObject(patch)) return list.map((series) => mergePatch(series, patch));
  if (!Array.isArray(patch)) return patch;
  const length = Math.max(list.length, patch.length);
  return Array.from({ length }, (_item, index) =>
    mergePatch(list[index] ?? {}, patch[index] ?? {}),
  );
}

/**
 * Applies a patch to a value.
 *
 * @param base - The value.
 * @param patch - The patch.
 * @returns The patched value; neither input changes.
 */
export function mergePatch(base: Json | undefined, patch: Json): Json {
  if (!isJsonObject(patch)) return patch;
  const merged: JsonObject = isJsonObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (key === 'series') merged[key] = mergeSeries(merged[key], value);
    else merged[key] = mergePatch(merged[key], value);
  }
  return merged;
}
