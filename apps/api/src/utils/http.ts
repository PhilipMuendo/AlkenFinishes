import type { NextFunction, Request, Response, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  static badRequest(msg = 'Bad request', details?: unknown) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Unauthorized') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'Forbidden') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Not found') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Conflict') {
    return new ApiError(409, msg);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
