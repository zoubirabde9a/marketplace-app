// Seller-supplied contact channels: phone, whatsapp, website.
// Lightweight validation only — these are seller-typed strings shown to buyers.

import { z } from "zod";

// E.164-ish: optional leading +, 7..15 digits. Allows internal spaces, dashes,
// and parens during input; we strip them before the regex check.
const PHONE_RE = /^\+?[0-9]{7,15}$/;

function normalizePhoneInput(v: string): string {
  return v.replace(/[\s\-().]/g, "");
}

export const SellerPhoneSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizePhoneInput)
  .refine((v) => PHONE_RE.test(v), { message: "invalid_phone" });

export const SellerWhatsappSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizePhoneInput)
  .refine((v) => PHONE_RE.test(v), { message: "invalid_whatsapp" });

export const SellerWebsiteSchema = z
  .string()
  .min(1)
  .max(512)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), { message: "invalid_website_scheme" });

export const SellerContactSchema = z.object({
  phone: SellerPhoneSchema.optional(),
  whatsapp: SellerWhatsappSchema.optional(),
  website: SellerWebsiteSchema.optional(),
});

export type SellerContact = z.infer<typeof SellerContactSchema>;
