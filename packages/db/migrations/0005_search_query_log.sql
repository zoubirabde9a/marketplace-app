-- Search query log. Drives synonym mining, zero-result alerts, "is search
-- getting worse" SLOs. Append-only, no PII (no session_id / IP / agent_id).

CREATE TABLE "audit"."search_queries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "query_raw" text NOT NULL,
  "query_normalized" text NOT NULL,
  "lang_guess" varchar(4),
  "n_results" integer NOT NULL,
  "latency_ms" integer NOT NULL,
  "has_filters" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "search_queries_zero_results_idx" ON "audit"."search_queries" USING btree ("n_results", "occurred_at");
--> statement-breakpoint
CREATE INDEX "search_queries_occurred_idx" ON "audit"."search_queries" USING btree ("occurred_at");
