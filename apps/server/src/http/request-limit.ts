/** The largest request body the server reads, for every route. */

/**
 * The most bytes a request body may hold: 8 MB. Bun refuses a larger body with a 413 before the
 * app reads it, whether or not the request states its length.
 */
export const maxRequestBytes = 8 * 1024 * 1024;
