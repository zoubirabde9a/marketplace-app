CREATE TABLE "audit"."dpop_jtis" (
	"jti" varchar(256) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."idempotency_keys" (
	"scope" varchar(200) NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_pk" ON "audit"."idempotency_keys" USING btree ("scope","key");