import { z } from "zod";

export const ISO_4217 = /^[A-Z]{3}$/;

export const CurrencySchema = z.string().regex(ISO_4217);
export type Currency = z.infer<typeof CurrencySchema>;

export const MoneySchema = z.object({
  amountMinor: z.bigint().nonnegative(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export function money(amountMinor: bigint | number, currency: string): Money {
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(Math.round(amountMinor));
  if (minor < 0n) throw new RangeError("Money cannot be negative");
  return { amountMinor: minor, currency: currency.toUpperCase() };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  if (b.amountMinor > a.amountMinor) throw new RangeError("Negative result");
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function mulMoney(a: Money, factor: number): Money {
  if (!Number.isFinite(factor) || factor < 0) throw new RangeError("Bad factor");
  // round half to even (banker's rounding) at minor units
  const product = Number(a.amountMinor) * factor;
  const rounded = bankersRound(product);
  return { amountMinor: BigInt(rounded), currency: a.currency };
}

function bankersRound(n: number): number {
  const r = Math.round(n);
  if (Math.abs(n - Math.trunc(n)) === 0.5) {
    return Math.trunc(n) % 2 === 0 ? Math.trunc(n) : r;
  }
  return r;
}

export function formatMoney(m: Money, locale = "en-US"): string {
  // assumes 2-decimal currencies; specialized handling for JPY/KRW/etc. would extend this
  const major = Number(m.amountMinor) / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(major);
}
