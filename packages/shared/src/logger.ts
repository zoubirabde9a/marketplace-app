import pino, { type Logger } from "pino";

const PII_KEYS = new Set([
  "password",
  "card_number",
  "pan",
  "cvv",
  "ssn",
  "tax_id",
  "authorization",
  "cookie",
  "set-cookie",
  "dpop",
  "secret",
  "private_key",
]);

export function createLogger(name: string, level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    name,
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: Array.from(PII_KEYS).map((k) => `*.${k}`).concat(Array.from(PII_KEYS)),
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
