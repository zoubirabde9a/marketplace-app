// Re-export every bounded-context schema so drizzle-kit and the client see the full model.

export * from "./identity.js";
export * from "./catalog.js";
export * from "./seller.js";
export * from "./cart.js";
export * from "./order.js";
export * from "./payment.js";
export * from "./messaging.js";
export * from "./review.js";
export * from "./promo.js";
export * from "./tax_shipping.js";
export * from "./audit.js";
