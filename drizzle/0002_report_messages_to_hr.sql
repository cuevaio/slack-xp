CREATE TABLE "hr_report_notification_outbox" (
	"outbox_id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_report_notification_outbox_report_id_unique" UNIQUE("report_id"),
	CONSTRAINT "hr_report_notification_outbox_id_check" CHECK (char_length("hr_report_notification_outbox"."outbox_id") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "hr_reports" (
	"report_id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"office_day" text NOT NULL,
	"office_channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"category" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_reports_report_id_check" CHECK (char_length("hr_reports"."report_id") between 1 and 255),
	CONSTRAINT "hr_reports_reporter_id_check" CHECK (char_length("hr_reports"."reporter_id") between 1 and 255),
	CONSTRAINT "hr_reports_office_day_check" CHECK ("hr_reports"."office_day" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "hr_reports_stable_references_check" CHECK (char_length("hr_reports"."office_channel_id") between 1 and 255 and char_length("hr_reports"."message_id") between 1 and 255),
	CONSTRAINT "hr_reports_category_check" CHECK ("hr_reports"."category" in ('harassment-or-bullying', 'hate-or-discrimination', 'threatening-behavior', 'sexual-content')),
	CONSTRAINT "hr_reports_state_check" CHECK ("hr_reports"."state" in ('open', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "hr_report_notification_outbox" ADD CONSTRAINT "hr_report_notification_outbox_report_id_hr_reports_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."hr_reports"("report_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_reporter_id_clerk_profiles_clerk_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."clerk_profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_report_notification_outbox_pending_idx" ON "hr_report_notification_outbox" USING btree ("created_at") WHERE "hr_report_notification_outbox"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_reports_one_open_message_per_reporter_idx" ON "hr_reports" USING btree ("reporter_id","office_channel_id","message_id") WHERE "hr_reports"."state" = 'open';