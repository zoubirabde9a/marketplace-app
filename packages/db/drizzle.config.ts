import type { Config } from "drizzle-kit";

export default {
  // Glob the schema files directly. Pointing at index.ts breaks because it
  // re-exports with .js extensions for ESM, and drizzle-kit's CJS loader
  // can't resolve those to the .ts source.
  schema: ["./src/schema/identity.ts", "./src/schema/catalog.ts", "./src/schema/seller.ts", "./src/schema/cart.ts", "./src/schema/order.ts", "./src/schema/payment.ts", "./src/schema/messaging.ts", "./src/schema/review.ts", "./src/schema/promo.ts", "./src/schema/tax_shipping.ts", "./src/schema/audit.ts"],
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace",
  },
  verbose: true,
  strict: true,
} satisfies Config;
