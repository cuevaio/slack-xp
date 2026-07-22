CREATE TABLE "office_days" (
	"office_day" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_days_office_day_check" CHECK ("office_days"."office_day" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "scripted_system_event_outbox" (
	"event_key" text PRIMARY KEY NOT NULL,
	"office_day" text NOT NULL,
	"script_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"character_id" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scripted_system_event_outbox_event_key_check" CHECK (char_length("scripted_system_event_outbox"."event_key") between 1 and 255),
	CONSTRAINT "scripted_system_event_outbox_script_id_check" CHECK (char_length("scripted_system_event_outbox"."script_id") between 1 and 80),
	CONSTRAINT "scripted_system_event_outbox_channel_id_check" CHECK (char_length("scripted_system_event_outbox"."channel_id") between 1 and 255),
	CONSTRAINT "scripted_system_event_outbox_character_id_check" CHECK ("scripted_system_event_outbox"."character_id" like 'office-character:%'),
	CONSTRAINT "scripted_system_event_outbox_attempt_count_check" CHECK ("scripted_system_event_outbox"."attempt_count" >= 0),
	CONSTRAINT "scripted_system_event_outbox_publish_attempt_check" CHECK ("scripted_system_event_outbox"."published_at" is null or "scripted_system_event_outbox"."last_attempt_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "scripted_system_event_outbox" ADD CONSTRAINT "scripted_system_event_outbox_office_day_office_days_office_day_fk" FOREIGN KEY ("office_day") REFERENCES "public"."office_days"("office_day") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scripted_system_event_outbox_day_script_uidx" ON "scripted_system_event_outbox" USING btree ("office_day","script_id");--> statement-breakpoint
CREATE INDEX "scripted_system_event_outbox_pending_idx" ON "scripted_system_event_outbox" USING btree ("due_at") WHERE "scripted_system_event_outbox"."published_at" is null;