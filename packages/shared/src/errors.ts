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
    // Bound the echoed id. Pre-fix a 10 MB id submitted in a URL path
    // (or via direct domain caller) would round-trip through `detail`
    // into the audit log + the problem+json response — wasted log bytes
    // and a memory hit per probe. 200 chars covers any legitimate id
    // shape (UUIDs ≤36, prefixed-ulids ≤32, slug ids ≤120). Replace any
    // control chars with `?` so a payload with embedded NUL/CR/LF can't
    // inject into a downstream consumer that renders the detail field
    // verbatim into a non-JSON surface (e.g. an operator dashboard
    // pasting error text into an HTML log viewer).
    const safe = String(id).slice(0, 200).replace(/[\x00-\x1f\x7f]/g, "?");
    super({
      type: "https://marketplace.dev/errors/not-found",
      title: `${resource} not found`,
      status: 404,
      detail: `No ${resource} with id=${safe}`,
    });
  }
}

export class ValidationError extends MarketplaceError {
  constructor(errors: Array<{ path: string; message: string }>) {
    // Bound the issue list. A Zod schema rejecting an attacker-submitted
    // array of 1000 bad values would otherwise produce a detail string +
    // extensions.errors array that bloats both the wire response and any
    // audit row capturing it. 50 issues is plenty of detail for any real
    // validation failure (typical request: 0–5 issues). Per-issue path
    // and message are also bounded so a 10 MB Zod custom-message can't
    // sneak through. Same defense-in-depth pattern as NotFoundError's
    // id-echo cap (pass #145).
    const capped = errors.slice(0, 50).map((e) => ({
      path: String(e.path).slice(0, 200),
      message: String(e.message).slice(0, 500),
    }));
    const detail = capped.map((e) => `${e.path}: ${e.message}`).join("; ").slice(0, 4000);
    super({
      type: "https://marketplace.dev/errors/validation",
      title: "Validation failed",
      status: 400,
      detail,
      extensions: {
        errors: capped,
        ...(errors.length > capped.length ? { truncated: errors.length - capped.length } : {}),
      },
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
