/** Errors a request can end with, mapped one to one onto the `/api` error shape. */
import type { ApiErrorCode } from '@querent/shared';

/** The HTTP status each error code is sent with. */
const statusByCode = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  source_failed: 502,
  internal: 500,
} as const satisfies Record<ApiErrorCode, number>;

/** The HTTP status of an application error. */
type AppErrorStatus = (typeof statusByCode)[ApiErrorCode];

/** An error whose code and message are safe to send to the client. */
export class AppError extends Error {
  /** The stable code the client switches on. */
  readonly code: ApiErrorCode;
  /** The HTTP status the response carries. */
  readonly status: AppErrorStatus;
  /** Structured context for the client, such as validation issues. */
  readonly details: unknown;

  /**
   * Creates an error that the error handler sends as `{ error: { code, message, details } }`.
   *
   * @param code - The stable error code.
   * @param message - A message safe to show to the user.
   * @param details - Optional structured context, sent as is.
   */
  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}
