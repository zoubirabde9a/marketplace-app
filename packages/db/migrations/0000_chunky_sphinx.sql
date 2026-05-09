CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "seller";
--> statement-breakpoint
CREATE SCHEMA "cart";
--> statement-breakpoint
CREATE SCHEMA "order";
--> statement-breakpoint
CREATE SCHEMA "payment";
--> statement-breakpoint
CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE SCHEMA "review";
--> statement-breakpoint
CREATE SCHEMA "promo";
--> statement-breakpoint
CREATE SCHEMA "tax_shipping";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "identity"."agent_passports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"issuer" varchar(256) NOT NULL,
	"scopes" jsonb NOT NULL,
	"spend_caps" jsonb NOT NULL,
	"allow_merchants" jsonb,
	"deny_merchants" jsonb,
	"allow_categories" jsonb,
	"deny_categories" jsonb,
	"audit_root" varchar(128),
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(64),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"name" varchar(200) NOT NULL,
	"agent_kind" varchar(16) NOT NULL,
	"public_key" text NOT NULL,
	"public_key_kid" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_user_id" uuid,
	"principal_org_id" uuid,
	"agent_id" uuid,
	"scope" varchar(64) NOT NULL,
	"granted" boolean NOT NULL,
	"source" varchar(64) NOT NULL,
	"proof" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."mfa_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"factor_kind" varchar(16) NOT NULL,
	"public_key" text,
	"credential_id" text,
	"sign_counter" integer DEFAULT 0 NOT NULL,
	"label" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."oauth_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"redirect_uris" jsonb NOT NULL,
	"scopes" jsonb NOT NULL,
	"auth_method" varchar(32) DEFAULT 'none' NOT NULL,
	"jwks_uri" varchar(512),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."org_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"legal_name" varchar(200),
	"country_code" varchar(2) NOT NULL,
	"tax_id_encrypted" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"kyb_status" varchar(32) DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"client_id" varchar(64),
	"dpop_jkt" varchar(64),
	"scopes" jsonb NOT NULL,
	"refresh_token_hash" varchar(128),
	"refresh_gen" integer DEFAULT 0 NOT NULL,
	"ip" varchar(45),
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" varchar(200),
	"locale" varchar(10) DEFAULT 'en-US' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."bundle_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bundle_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."bundles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"bundle_sku" varchar(200) NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."canonical_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"brand" varchar(200),
	"gtin14" varchar(14),
	"mpn" varchar(200),
	"category_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hero_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"slug" varchar(200) NOT NULL,
	"name" varchar(200) NOT NULL,
	"taxonomy_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog"."digital_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_uri" text NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"byte_size" integer NOT NULL,
	"license_terms" text,
	"drm_kind" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."embedding_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"model_key" varchar(64) NOT NULL,
	"model_version" varchar(32) NOT NULL,
	"dimensions" integer NOT NULL,
	"role" varchar(16) DEFAULT 'inactive' NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog"."inventory_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"safety_stock" integer DEFAULT 0 NOT NULL,
	"backorderable" boolean DEFAULT false NOT NULL,
	"low_stock_threshold" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."inventory_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"postal_code" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."listing_canonical_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"candidate_canonical_id" uuid NOT NULL,
	"confidence" varchar(16) NOT NULL,
	"match_method" varchar(32) NOT NULL,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"product_id" uuid,
	"url" text NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"byte_size" integer NOT NULL,
	"perceptual_hash" varchar(64),
	"alt_text" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."price_list_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"min_qty" integer DEFAULT 1 NOT NULL,
	"price_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"customer_segment" varchar(64),
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_embeddings" (
	"product_id" uuid NOT NULL,
	"model_key" varchar(64) NOT NULL,
	"model_version" varchar(32) NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(200) NOT NULL,
	"options" jsonb NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"sale_price_minor" bigint NOT NULL,
	"floor_price_minor" bigint NOT NULL,
	"weight_grams" integer,
	"dimensions_cm" jsonb,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"canonical_id" uuid,
	"canonical_confidence" varchar(16),
	"sku" varchar(200) NOT NULL,
	"title_raw" text NOT NULL,
	"title_sanitized" text NOT NULL,
	"description_raw" text,
	"description_sanitized" text,
	"brand" varchar(200),
	"gtin14" varchar(14),
	"mpn" varchar(200),
	"category_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"product_kind" varchar(16) DEFAULT 'physical' NOT NULL,
	"is_hazmat" boolean DEFAULT false NOT NULL,
	"is_age_restricted" boolean DEFAULT false NOT NULL,
	"min_age" integer,
	"export_control_class" varchar(32),
	"counterfeit_risk" varchar(16) DEFAULT 'low' NOT NULL,
	"moderation_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller"."brand_registry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand" varchar(200) NOT NULL,
	"owner_org_id" uuid,
	"authorized_sellers" jsonb,
	"authoritative_attributes" jsonb,
	"status" varchar(16) DEFAULT 'verified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_registry_brand_unique" UNIQUE("brand")
);
--> statement-breakpoint
CREATE TABLE "seller"."kyb_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_ref" varchar(200) NOT NULL,
	"status" varchar(32) NOT NULL,
	"evidence" jsonb,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller"."payout_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_account_id" varchar(200) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"status" varchar(32) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller"."seller_metrics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"orders_count_30d" integer DEFAULT 0 NOT NULL,
	"cancellation_rate_30d_bps" integer DEFAULT 0 NOT NULL,
	"refund_rate_30d_bps" integer DEFAULT 0 NOT NULL,
	"dispute_rate_30d_bps" integer DEFAULT 0 NOT NULL,
	"avg_ship_hours_30d" integer,
	"rating_avg_bps" integer,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_metrics_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "seller"."seller_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"returns_window_days" integer DEFAULT 30 NOT NULL,
	"restocking_fee_bps" integer DEFAULT 0 NOT NULL,
	"shipping_sla_hours" integer DEFAULT 48 NOT NULL,
	"warranty_months" integer,
	"accepts_returns" boolean DEFAULT true NOT NULL,
	"policies_text" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_policies_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "seller"."seller_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"store_name" varchar(200) NOT NULL,
	"store_slug" varchar(200) NOT NULL,
	"description" text,
	"support_email" varchar(320),
	"support_url" varchar(512),
	"phone" varchar(32),
	"whatsapp" varchar(32),
	"website" varchar(512),
	"active" boolean DEFAULT false NOT NULL,
	"reserve_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_profiles_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "seller_profiles_store_slug_unique" UNIQUE("store_slug")
);
--> statement-breakpoint
CREATE TABLE "cart"."cart_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"list_price_minor" bigint NOT NULL,
	"negotiated_quote_id" uuid,
	"options" jsonb,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart"."carts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"owner_agent_id" uuid,
	"mandate_id" varchar(128),
	"currency" varchar(3) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"expires_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart"."saved_for_later" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart"."wishlist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart"."wishlists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"owner_agent_id" uuid,
	"name" varchar(200) NOT NULL,
	"visibility" varchar(16) DEFAULT 'private' NOT NULL,
	"share_token" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order"."fulfillments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order"."order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"shipping_minor" bigint NOT NULL,
	"discount_minor" bigint NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	"fulfillment_status" varchar(32) DEFAULT 'unfulfilled' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order"."order_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" varchar(32),
	"to_status" varchar(32) NOT NULL,
	"reason" varchar(200),
	"actor_kind" varchar(16) NOT NULL,
	"actor_id" varchar(128),
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order"."orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_number" varchar(32) NOT NULL,
	"buyer_user_id" uuid,
	"buyer_agent_id" uuid,
	"buyer_org_id" uuid,
	"cart_id" uuid,
	"mandate_id" varchar(128),
	"payment_mandate_id" varchar(128),
	"payment_intent_id" uuid,
	"currency" varchar(3) NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"discount_minor" bigint NOT NULL,
	"shipping_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"tip_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"status" varchar(32) DEFAULT 'created' NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"idempotency_key" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_number_unique" UNIQUE("public_number")
);
--> statement-breakpoint
CREATE TABLE "order"."return_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"condition" varchar(32),
	"inspection_notes" text
);
--> statement-breakpoint
CREATE TABLE "order"."returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"rma_code" varchar(32) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"reason_detail" text,
	"status" varchar(32) DEFAULT 'requested' NOT NULL,
	"refund_minor" bigint NOT NULL,
	"restocking_fee_minor" bigint NOT NULL,
	"return_label_url" text,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_rma_code_unique" UNIQUE("rma_code")
);
--> statement-breakpoint
CREATE TABLE "order"."shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"carrier" varchar(64) NOT NULL,
	"service" varchar(64),
	"tracking_number" varchar(128),
	"tracking_url" text,
	"weight_grams" integer,
	"shipping_label_url" text,
	"customs_declaration" jsonb,
	"status" varchar(32) DEFAULT 'label_purchased' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order"."subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"buyer_user_id" uuid,
	"buyer_agent_id" uuid,
	"parent_mandate_id" varchar(128) NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"interval_kind" varchar(16) NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"next_renewal_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"total_cap_minor" bigint NOT NULL,
	"consumed_minor" bigint NOT NULL,
	"end_after_cycles" integer,
	"cycles_completed" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"paused_reason" varchar(64),
	"mandate_refresh_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."chargebacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"provider_case_id" varchar(200) NOT NULL,
	"reason_code" varchar(32) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(32) NOT NULL,
	"evidence_due_at" timestamp with time zone,
	"evidence_submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"opened_by_user_id" uuid,
	"opened_by_agent_id" uuid,
	"reason" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"amount_claimed_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"evidence" jsonb,
	"resolution" jsonb,
	"resolved_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."escrow_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"release_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"status" varchar(32) DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_kind" varchar(32) NOT NULL,
	"owner_org_id" uuid,
	"owner_user_id" uuid,
	"currency" varchar(3) NOT NULL,
	"normal_side" varchar(8) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tx_group_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"side" varchar(8) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"order_id" uuid,
	"leg_type" varchar(32) NOT NULL,
	"external_ref" varchar(200),
	"posted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_kind" varchar(16) NOT NULL,
	"parent_mandate_id" uuid,
	"principal_user_id" uuid,
	"principal_org_id" uuid,
	"agent_id" uuid,
	"passport_id" uuid,
	"content_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"spend_cap_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"constraints" jsonb,
	"recurrence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "payment"."payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid,
	"order_id" uuid,
	"cart_mandate_id" uuid,
	"payment_mandate_id" uuid,
	"buyer_user_id" uuid,
	"buyer_agent_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(32) DEFAULT 'requires_confirmation' NOT NULL,
	"provider" varchar(32) DEFAULT 'stripe' NOT NULL,
	"provider_intent_id" varchar(200),
	"client_secret" varchar(256),
	"idempotency_key" varchar(128),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"provider" varchar(32) NOT NULL,
	"provider_method_id" varchar(200) NOT NULL,
	"method_kind" varchar(32) NOT NULL,
	"last4" varchar(8),
	"brand" varchar(32),
	"expires_month" integer,
	"expires_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_single_use" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payout_account_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_payout_id" varchar(200),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"hold_reason" varchar(200),
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"return_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"routing_method" varchar(32) NOT NULL,
	"routing_provider_ref" varchar(200),
	"reason" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"initiated_by" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."saga_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"saga_kind" varchar(64) NOT NULL,
	"order_id" uuid,
	"state" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"step" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid,
	"order_id" uuid,
	"tx_kind" varchar(16) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_tx_id" varchar(200) NOT NULL,
	"status" varchar(32) NOT NULL,
	"idempotency_key" varchar(128),
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_provider_event" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."wallet_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"currency" varchar(3) NOT NULL,
	"available_minor" bigint NOT NULL,
	"pending_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."agent_dialogues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill" varchar(64) NOT NULL,
	"from_agent_id" uuid NOT NULL,
	"to_agent_id" uuid NOT NULL,
	"transcript" jsonb NOT NULL,
	"transcript_hash" varchar(128) NOT NULL,
	"outcome" varchar(32),
	"related_order_id" uuid,
	"related_mandate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_kind" varchar(16) NOT NULL,
	"sender_id" varchar(128) NOT NULL,
	"body_raw" text NOT NULL,
	"body_sanitized" text NOT NULL,
	"attachments" jsonb,
	"author_kind" varchar(16) DEFAULT 'human' NOT NULL,
	"redacted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_user_id" uuid,
	"recipient_agent_id" uuid,
	"channel" varchar(16) NOT NULL,
	"topic" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_kind" varchar(32) NOT NULL,
	"subject_id" uuid,
	"participant_user_ids" jsonb,
	"participant_agent_ids" jsonb,
	"participant_org_ids" jsonb,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"webhook_id" uuid NOT NULL,
	"topic" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"idempotency_token" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"response_status" integer,
	"response_body_snippet" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."webhooks_outbound" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"endpoint_url" text NOT NULL,
	"topics" jsonb NOT NULL,
	"signing_secret" text NOT NULL,
	"public_key_kid" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review"."review_appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"filed_by_kind" varchar(16) NOT NULL,
	"filed_by_id" varchar(128) NOT NULL,
	"argument" text,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review"."review_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"responder_org_id" uuid NOT NULL,
	"body_sanitized" text NOT NULL,
	"body_raw" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review"."review_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"signal" varchar(64) NOT NULL,
	"weight" integer NOT NULL,
	"evidence" jsonb,
	"detected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review"."reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid,
	"canonical_product_id" uuid,
	"order_item_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"reviewer_agent_id" uuid,
	"author_kind" varchar(16) NOT NULL,
	"rating" integer NOT NULL,
	"title_sanitized" text,
	"body_sanitized" text NOT NULL,
	"body_raw" text NOT NULL,
	"verified_purchase" boolean DEFAULT false NOT NULL,
	"outcome" varchar(16),
	"moderation_status" varchar(16) DEFAULT 'visible' NOT NULL,
	"suppression_reason" varchar(64),
	"suspicion_score" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo"."affiliate_partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"tracking_code" varchar(64) NOT NULL,
	"commission_bps" integer NOT NULL,
	"cookie_window_days" integer DEFAULT 30 NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_partners_tracking_code_unique" UNIQUE("tracking_code")
);
--> statement-breakpoint
CREATE TABLE "promo"."coupon_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"principal_user_id" uuid,
	"principal_agent_id" uuid,
	"amount_saved_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"redeemed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo"."coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"promotion_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"max_uses_per_principal" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo"."gift_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"initial_minor" bigint NOT NULL,
	"balance_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"issued_to_user_id" uuid,
	"issued_to_agent_id" uuid,
	"expires_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo"."loyalty_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"owner_agent_id" uuid,
	"program_key" varchar(64) NOT NULL,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"tier" varchar(32) DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo"."loyalty_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" varchar(64) NOT NULL,
	"reference" jsonb,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo"."promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_org_id" uuid,
	"name" varchar(200) NOT NULL,
	"promo_kind" varchar(32) NOT NULL,
	"conditions" jsonb NOT NULL,
	"benefits" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo"."referrals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"referrer_user_id" uuid,
	"referrer_agent_id" uuid,
	"invite_code" varchar(32) NOT NULL,
	"referred_user_id" uuid,
	"reward_kind" varchar(32) NOT NULL,
	"reward_value" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."carriers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"carrier_key" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"api_credentials" jsonb,
	"prohibited_items" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_carrier_key_unique" UNIQUE("carrier_key")
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."customs_declarations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"hs_code" varchar(16),
	"declared_value_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"contents_category" varchar(32) NOT NULL,
	"contents_description" text,
	"export_control_class" varchar(32),
	"country_of_origin" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."fx_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"base" varchar(3) NOT NULL,
	"quote" varchar(3) NOT NULL,
	"rate" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."restricted_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"taxonomy_key" varchar(64) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"subdivision_code" varchar(8),
	"restriction_kind" varchar(32) NOT NULL,
	"min_age" integer,
	"license_required_of" varchar(16),
	"notes" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source" varchar(64) NOT NULL,
	"registry_version" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."sanctioned_parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list" varchar(32) NOT NULL,
	"name" varchar(400) NOT NULL,
	"aliases" jsonb,
	"country_code" varchar(2),
	"identifiers" jsonb,
	"listed_at" timestamp with time zone NOT NULL,
	"delisted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."shipping_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"carrier" varchar(64) NOT NULL,
	"service" varchar(64) NOT NULL,
	"flat_minor" bigint NOT NULL,
	"per_kg_minor" bigint NOT NULL,
	"free_over_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"est_delivery_days" integer,
	"hazmat_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."shipping_zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_org_id" uuid,
	"name" varchar(200) NOT NULL,
	"country_codes" jsonb NOT NULL,
	"postal_ranges" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."tax_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"product_category_key" varchar(64) DEFAULT 'default' NOT NULL,
	"rate_bps" integer NOT NULL,
	"label" varchar(64),
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tax_shipping"."tax_zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"subdivision_code" varchar(8),
	"postal_ranges" jsonb,
	"is_marketplace_facilitator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."agent_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"passport_id" uuid,
	"tool_name" varchar(96) NOT NULL,
	"scope" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_hash" varchar(128),
	"output_hash" varchar(128),
	"error_code" varchar(64),
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."agent_reputation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"score_bps" integer NOT NULL,
	"components" jsonb NOT NULL,
	"insufficient_data" boolean DEFAULT true NOT NULL,
	"last_updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_reputation_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_chain_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"merkle_root" varchar(128) NOT NULL,
	"external_anchor_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_kind" varchar(16) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"event_kind" varchar(64) NOT NULL,
	"subject_kind" varchar(32),
	"subject_id" varchar(128),
	"payload" jsonb NOT NULL,
	"prev_hash" varchar(128),
	"self_hash" varchar(128) NOT NULL,
	"request_id" varchar(64),
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."consent_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_id" varchar(128) NOT NULL,
	"scope" varchar(64) NOT NULL,
	"granted" boolean NOT NULL,
	"proof" jsonb,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."counterfeit_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"finding" varchar(16) NOT NULL,
	"arbitration_kind" varchar(16) NOT NULL,
	"evidence" jsonb NOT NULL,
	"decided_by" varchar(128) NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."mandate_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"receipt_vdc" text NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"order_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."mandate_vault" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"encrypted_vdc" text NOT NULL,
	"encryption_kid" varchar(64) NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"redacted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandate_vault_mandate_id_unique" UNIQUE("mandate_id")
);
--> statement-breakpoint
CREATE TABLE "audit"."reputation_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"vdc" text NOT NULL,
	"signature" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."agent_passports" ADD CONSTRAINT "agent_passports_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."agents" ADD CONSTRAINT "agents_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consents" ADD CONSTRAINT "consents_principal_user_id_users_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consents" ADD CONSTRAINT "consents_principal_org_id_organizations_id_fk" FOREIGN KEY ("principal_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consents" ADD CONSTRAINT "consents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauth_clients" ADD CONSTRAINT "oauth_clients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauth_clients" ADD CONSTRAINT "oauth_clients_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."bundle_items" ADD CONSTRAINT "bundle_items_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "catalog"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."bundle_items" ADD CONSTRAINT "bundle_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."bundles" ADD CONSTRAINT "bundles_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."canonical_products" ADD CONSTRAINT "canonical_products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "catalog"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."digital_assets" ADD CONSTRAINT "digital_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "catalog"."inventory_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."inventory_locations" ADD CONSTRAINT "inventory_locations_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."listing_canonical_suggestions" ADD CONSTRAINT "listing_canonical_suggestions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."listing_canonical_suggestions" ADD CONSTRAINT "listing_canonical_suggestions_candidate_canonical_id_canonical_products_id_fk" FOREIGN KEY ("candidate_canonical_id") REFERENCES "catalog"."canonical_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."media" ADD CONSTRAINT "media_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."media" ADD CONSTRAINT "media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."price_list_entries" ADD CONSTRAINT "price_list_entries_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "catalog"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."price_list_entries" ADD CONSTRAINT "price_list_entries_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."price_lists" ADD CONSTRAINT "price_lists_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_embeddings" ADD CONSTRAINT "product_embeddings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_versions" ADD CONSTRAINT "product_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_canonical_id_canonical_products_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "catalog"."canonical_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "catalog"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller"."brand_registry" ADD CONSTRAINT "brand_registry_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller"."kyb_records" ADD CONSTRAINT "kyb_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller"."payout_accounts" ADD CONSTRAINT "payout_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller"."seller_metrics" ADD CONSTRAINT "seller_metrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller"."seller_policies" ADD CONSTRAINT "seller_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller"."seller_profiles" ADD CONSTRAINT "seller_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "cart"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."cart_items" ADD CONSTRAINT "cart_items_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."carts" ADD CONSTRAINT "carts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."carts" ADD CONSTRAINT "carts_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."carts" ADD CONSTRAINT "carts_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."saved_for_later" ADD CONSTRAINT "saved_for_later_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "cart"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."saved_for_later" ADD CONSTRAINT "saved_for_later_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "cart"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."wishlists" ADD CONSTRAINT "wishlists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."wishlists" ADD CONSTRAINT "wishlists_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."fulfillments" ADD CONSTRAINT "fulfillments_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."order_items" ADD CONSTRAINT "order_items_seller_id_organizations_id_fk" FOREIGN KEY ("seller_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."orders" ADD CONSTRAINT "orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."orders" ADD CONSTRAINT "orders_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."orders" ADD CONSTRAINT "orders_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "order"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "order"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."shipments" ADD CONSTRAINT "shipments_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "order"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."subscriptions" ADD CONSTRAINT "subscriptions_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."subscriptions" ADD CONSTRAINT "subscriptions_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."subscriptions" ADD CONSTRAINT "subscriptions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."disputes" ADD CONSTRAINT "disputes_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."disputes" ADD CONSTRAINT "disputes_opened_by_agent_id_agents_id_fk" FOREIGN KEY ("opened_by_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."escrow_holds" ADD CONSTRAINT "escrow_holds_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "payment"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."mandates" ADD CONSTRAINT "mandates_principal_user_id_users_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."mandates" ADD CONSTRAINT "mandates_principal_org_id_organizations_id_fk" FOREIGN KEY ("principal_org_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."mandates" ADD CONSTRAINT "mandates_passport_id_agent_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "identity"."agent_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_intents" ADD CONSTRAINT "payment_intents_cart_mandate_id_mandates_id_fk" FOREIGN KEY ("cart_mandate_id") REFERENCES "payment"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_intents" ADD CONSTRAINT "payment_intents_payment_mandate_id_mandates_id_fk" FOREIGN KEY ("payment_mandate_id") REFERENCES "payment"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_intents" ADD CONSTRAINT "payment_intents_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_intents" ADD CONSTRAINT "payment_intents_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_methods" ADD CONSTRAINT "payment_methods_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_methods" ADD CONSTRAINT "payment_methods_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payouts" ADD CONSTRAINT "payouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."transactions" ADD CONSTRAINT "transactions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "payment"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."wallet_balances" ADD CONSTRAINT "wallet_balances_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."wallet_balances" ADD CONSTRAINT "wallet_balances_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."agent_dialogues" ADD CONSTRAINT "agent_dialogues_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."agent_dialogues" ADD CONSTRAINT "agent_dialogues_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "messaging"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."notifications" ADD CONSTRAINT "notifications_recipient_agent_id_agents_id_fk" FOREIGN KEY ("recipient_agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_outbound_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "messaging"."webhooks_outbound"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."webhooks_outbound" ADD CONSTRAINT "webhooks_outbound_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review"."review_appeals" ADD CONSTRAINT "review_appeals_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "review"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review"."review_responses" ADD CONSTRAINT "review_responses_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "review"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review"."review_signals" ADD CONSTRAINT "review_signals_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "review"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review"."reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review"."reviews" ADD CONSTRAINT "reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review"."reviews" ADD CONSTRAINT "reviews_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."affiliate_partners" ADD CONSTRAINT "affiliate_partners_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "promo"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."coupons" ADD CONSTRAINT "coupons_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "promo"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."gift_cards" ADD CONSTRAINT "gift_cards_issued_to_user_id_users_id_fk" FOREIGN KEY ("issued_to_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."gift_cards" ADD CONSTRAINT "gift_cards_issued_to_agent_id_agents_id_fk" FOREIGN KEY ("issued_to_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "promo"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."promotions" ADD CONSTRAINT "promotions_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."referrals" ADD CONSTRAINT "referrals_referrer_agent_id_agents_id_fk" FOREIGN KEY ("referrer_agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo"."referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_shipping"."shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "tax_shipping"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_shipping"."shipping_zones" ADD CONSTRAINT "shipping_zones_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_shipping"."tax_rates" ADD CONSTRAINT "tax_rates_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "tax_shipping"."tax_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."agent_actions" ADD CONSTRAINT "agent_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."agent_actions" ADD CONSTRAINT "agent_actions_passport_id_agent_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "identity"."agent_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."agent_reputation" ADD CONSTRAINT "agent_reputation_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."reputation_exports" ADD CONSTRAINT "reputation_exports_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "identity"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_passports_unique_active" ON "identity"."agent_passports" USING btree ("agent_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_unique" ON "identity"."org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "identity"."users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "canonical_products_gtin_idx" ON "catalog"."canonical_products" USING btree ("gtin14","brand");--> statement-breakpoint
CREATE INDEX "canonical_products_mpn_idx" ON "catalog"."canonical_products" USING btree ("mpn","brand");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_models_unique" ON "catalog"."embedding_models" USING btree ("model_key","model_version");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_levels_unique" ON "catalog"."inventory_levels" USING btree ("variant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_entries_unique" ON "catalog"."price_list_entries" USING btree ("price_list_id","variant_id","min_qty");--> statement-breakpoint
CREATE UNIQUE INDEX "product_embeddings_pk" ON "catalog"."product_embeddings" USING btree ("product_id","model_key","model_version");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_unique" ON "catalog"."product_variants" USING btree ("product_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "product_versions_unique" ON "catalog"."product_versions" USING btree ("product_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "products_seller_sku_unique" ON "catalog"."products" USING btree ("seller_id","sku");--> statement-breakpoint
CREATE INDEX "products_canonical_idx" ON "catalog"."products" USING btree ("canonical_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "catalog"."products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_unique" ON "cart"."cart_items" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_unique" ON "cart"."wishlist_items" USING btree ("wishlist_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_unique" ON "order"."orders" USING btree ("idempotency_key","buyer_agent_id","buyer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_unique" ON "payment"."ledger_accounts" USING btree ("account_kind","owner_org_id","owner_user_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "mandates_principal_idx" ON "payment"."mandates" USING btree ("principal_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_dialogues_hash_unique" ON "messaging"."agent_dialogues" USING btree ("transcript_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_item_unique" ON "review"."reviews" USING btree ("order_item_id","reviewer_user_id","reviewer_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_unique" ON "promo"."coupons" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_unique" ON "tax_shipping"."fx_rates" USING btree ("base","quote","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "restricted_items_unique" ON "tax_shipping"."restricted_items" USING btree ("taxonomy_key","country_code","subdivision_code","restriction_kind","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_unique" ON "tax_shipping"."tax_rates" USING btree ("zone_id","product_category_key","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_seq_unique" ON "audit"."audit_events" USING btree ("occurred_at","seq");