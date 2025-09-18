export type ErrorWithCause = Error & { cause?: unknown };

export const assignErrorCause = <T extends Error>(error: T, cause: unknown): T => {
  (error as ErrorWithCause).cause = cause;
  return error;
};

export const createErrorWithCause = (message: string, cause: unknown): Error => {
  return assignErrorCause(new Error(message), cause);
};

export const getErrorCause = (error: Error): unknown => (error as ErrorWithCause).cause;
