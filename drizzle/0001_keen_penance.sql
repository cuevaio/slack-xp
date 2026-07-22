CREATE TABLE "profile_invalidation_outbox" (
	"event_key" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_invalidation_outbox_event_key_check" CHECK (char_length("profile_invalidation_outbox"."event_key") between 1 and 255),
	CONSTRAINT "profile_invalidation_outbox_profile_id_check" CHECK (char_length("profile_invalidation_outbox"."profile_id") between 1 and 255)
);
--> statement-breakpoint
CREATE INDEX "profile_invalidation_outbox_pending_idx" ON "profile_invalidation_outbox" USING btree ("created_at") WHERE "profile_invalidation_outbox"."published_at" is null;