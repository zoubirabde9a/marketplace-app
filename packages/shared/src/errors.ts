// RFC 9457 Problem+JSON error model.

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Array<{ path: string; message: string }>;
  [k: string]: unknown;
}

export class MarketplaceError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly extensions: Record<string, unknown>;

  constructor(opts: {
    type: string;
    title: string;
    status: number;
    detail?: string;
    cause?: unknown;
    extensions?: Record<string, unknown>;
  }) {
    const code = opts.extensions?.["code"];
    const message =
      opts.detail !== undefined
        ? typeof code === "string"
          ? `${opts.title}: ${opts.detail} [${code}]`
          : `${opts.title}: ${opts.detail}`
        : typeof code === "string"
        ? `${opts.title} [${code}]`
        : opts.title;
    super(message, opts.cause ? { cause: opts.cause } : {});
    this.name = "MarketplaceError";
    this.type = opts.type;
    this.title = opts.title;
    this.status = opts.status;
    if (opts.detail !== undefined) this.detail = opts.detail;
    this.extensions = opts.extensions ?? {};
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(instance !== undefined ? { instance } : {}),
      ...this.extensions,
    };
  }
}

export class NotFoundError extends MarketplaceError {
  constructor(resource: string, id: string) {
    super({
      type: "https://marketplace.dev/errors/not-found",
      title: `${resource} not found`,
      status: 404,
      detail: `No ${resource} with id=${id}`,
    });
  }
}

export class ValidationError extends MarketplaceError {
  constructor(errors: Array<{ path: string; message: string }>) {
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    super({
      type: "https://marketplace.dev/errors/validation",
      title: "Validation failed",
      status: 400,
      detail,
      extensions: { errors },
    });
  }
}

export class UnauthorizedError extends MarketplaceError {
  constructor(detail = "Authentication required") {
    super({
      type: "https://marketplace.dev/errors/unauthorized",
      title: "Unauthorized",
      status: 401,
      detail,
    });
  }
}

export class ForbiddenError extends MarketplaceError {
  constructor(detail = "Forbidden") {
    super({
      type: "https://marketplace.dev/errors/forbidden",
      title: "Forbidden",
      status: 403,
      detail,
    });
  }
}

export class ConflictError extends MarketplaceError {
  constructor(detail: string) {
    super({
      type: "https://marketplace.dev/errors/conflict",
      title: "Conflict",
      status: 409,
      detail,
    });
  }
}

export class MandateError extends MarketplaceError {
  constructor(detail: string, code: string) {
    super({
      type: "https://marketplace.dev/errors/mandate",
      title: "Mandate verification failed",
      status: 403,
      detail,
      extensions: { code },
    });
  }
}

export class StepUpRequiredError extends MarketplaceError {
  constructor(requiredTier: number, detail = "Step-up authentication required") {
    super({
      type: "https://marketplace.dev/errors/step-up",
      title: "Step-up required",
      status: 401,
      detail,
      extensions: { required_tier: requiredTier },
    });
  }
}

export class RateLimitedError extends MarketplaceError {
  constructor(retryAfterSeconds: number) {
    super({
      type: "https://marketplace.dev/errors/rate-limit",
      title: "Too many requests",
      status: 429,
      extensions: { retry_after_seconds: retryAfterSeconds },
    });
  }
}
