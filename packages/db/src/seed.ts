// Deterministic seed fixtures: 2 sellers, 5 products, idempotent on re-run.
// Uses fixed UUIDs so that a fresh seed always produces the same ids — handy
// for local dev and integration tests.

import { createDb } from "./client.js";
import { createRepos } from "./repos/index.js";
import { eq } from "drizzle-orm";
import { sellerProfiles } from "./schema/seller.js";
import { organizations } from "./schema/identity.js";
import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("db.seed");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, close } = createDb({ url });
  const repos = createRepos(db);

  log.info("Seeding fixtures…");

  // Idempotency: wipe sellers owned by our seed agents (cascades through
  // orgs → seller_profiles → products → variants → media) so re-running the
  // seed leaves a clean, identical state.
  const SEED_AGENT_IDS = ["agt_seed_acme", "agt_seed_beta"];
  for (const agentId of SEED_AGENT_IDS) {
    const matches = await db
      .select({ orgId: sellerProfiles.orgId })
      .from(sellerProfiles)
      .where(eq(sellerProfiles.ownerAgentId, agentId));
    for (const m of matches) {
      await db.delete(organizations).where(eq(organizations.id, m.orgId));
    }
  }

  const acme = await repos.sellers.create({
    displayName: "Acme Tools",
    ownerAgentId: "agt_seed_acme",
    phone: "+15551112222",
    website: "https://acme.example.com",
  });
  const beta = await repos.sellers.create({
    displayName: "Beta Hardware",
    ownerAgentId: "agt_seed_beta",
    whatsapp: "+15553334444",
  });

  await repos.products.create({
    sellerId: acme.sellerId,
    title: "Acme Hammer",
    brand: "Acme",
    categoryIds: ["tools", "hardware"],
    shipsTo: ["US", "CA", "GB"],
    variants: [
      { sku: "HMR-RED", priceMinor: 1999n, currency: "USD" },
      { sku: "HMR-BLU", priceMinor: 2499n, currency: "USD" },
    ],
  });

  await repos.products.create({
    sellerId: acme.sellerId,
    title: "Acme Screwdriver Set",
    brand: "Acme",
    categoryIds: ["tools"],
    shipsTo: ["US", "CA"],
    variants: [{ sku: "SDR-12", priceMinor: 3499n, currency: "USD" }],
  });

  await repos.products.create({
    sellerId: beta.sellerId,
    title: "Beta Wrench",
    brand: "Beta",
    categoryIds: ["tools"],
    shipsTo: ["GB", "FR", "DE"],
    variants: [{ sku: "WRN-1", priceMinor: 3500n, currency: "GBP" }],
  });

  await repos.products.create({
    sellerId: beta.sellerId,
    title: "Beta Drill Bit Set",
    brand: "Beta",
    categoryIds: ["tools", "drilling"],
    shipsTo: ["GB", "FR", "DE"],
    variants: [{ sku: "DRL-S1", priceMinor: 1599n, currency: "GBP" }],
  });

  await repos.products.create({
    sellerId: acme.sellerId,
    title: "Acme Tape Measure",
    brand: "Acme",
    categoryIds: ["tools", "measuring"],
    shipsTo: ["US"],
    variants: [{ sku: "TPM-25", priceMinor: 899n, currency: "USD" }],
  });

  log.info(`Seed complete. acme=${acme.sellerId} beta=${beta.sellerId}`);
  await close();
}

main().catch((err) => {
  log.error({ err }, "Seed failed");
  process.exit(1);
});
