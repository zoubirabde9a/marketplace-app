ALTER TABLE "identity"."users" ADD COLUMN "picture" text;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "google_sub" varchar(64);--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD COLUMN "in_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD COLUMN "category_ids" jsonb;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD COLUMN "ships_to" jsonb;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD COLUMN "hero_media_id" uuid;--> statement-breakpoint
ALTER TABLE "seller"."seller_profiles" ADD COLUMN "owner_agent_id" varchar(200) NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "seller"."seller_profiles" ALTER COLUMN "owner_agent_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "cart"."carts" ADD COLUMN "owner_kind" varchar(16) DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "order"."orders" ADD COLUMN "access_token" varchar(128);--> statement-breakpoint
ALTER TABLE "order"."orders" ADD COLUMN "owner_kind" varchar(16) DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_unique" ON "identity"."users" USING btree ("google_sub");