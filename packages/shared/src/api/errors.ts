/** The one error shape every `/api` endpoint returns. */
import { z } from 'zod';

/** Stable error codes. The web app switches on these, never on messages. */
export const apiErrorCodes = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'source_failed',
  'internal',
] as const;

/** A stable error code. */
export type ApiErrorCode = (typeof apiErrorCodes)[number];

/** Validates an error response body: `{ error: { code, message, details? } }`. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** An error response body. */
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
