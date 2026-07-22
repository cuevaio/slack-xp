CREATE TABLE "message_removal_invalidation_outbox" (
	"outbox_id" text PRIMARY KEY NOT NULL,
	"removal_id" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_removal_invalidation_outbox_removal_id_unique" UNIQUE("removal_id"),
	CONSTRAINT "message_removal_invalidation_outbox_id_check" CHECK (char_length("message_removal_invalidation_outbox"."outbox_id") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "message_removals" (
	"removal_id" text PRIMARY KEY NOT NULL,
	"office_day" text NOT NULL,
	"office_channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"removed_by" text NOT NULL,
	"removed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_removals_removal_id_check" CHECK (char_length("message_removals"."removal_id") between 1 and 255),
	CONSTRAINT "message_removals_office_day_check" CHECK ("message_removals"."office_day" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "message_removals_stable_references_check" CHECK (char_length("message_removals"."office_channel_id") between 1 and 255 and "message_removals"."office_channel_id" like '%:' || "message_removals"."office_day" and char_length("message_removals"."message_id") between 1 and 255),
	CONSTRAINT "message_removals_removed_by_check" CHECK (char_length("message_removals"."removed_by") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_state_check";--> statement-breakpoint
ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_resolution_check";--> statement-breakpoint
ALTER TABLE "operator_actions" DROP CONSTRAINT "operator_actions_hr_report_dismissal_check";--> statement-breakpoint
ALTER TABLE "operator_actions" DROP CONSTRAINT "operator_actions_target_id_hr_reports_report_id_fk";
--> statement-breakpoint
DROP INDEX "operator_actions_one_report_dismissal_idx";--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "removed_by" text;--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_removal_invalidation_outbox" ADD CONSTRAINT "message_removal_invalidation_outbox_removal_id_message_removals_removal_id_fk" FOREIGN KEY ("removal_id") REFERENCES "public"."message_removals"("removal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_removal_invalidation_outbox_pending_idx" ON "message_removal_invalidation_outbox" USING btree ("created_at") WHERE "message_removal_invalidation_outbox"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "message_removals_message_uidx" ON "message_removals" USING btree ("office_channel_id","message_id");--> statement-breakpoint
CREATE INDEX "message_removals_channel_idx" ON "message_removals" USING btree ("office_channel_id","removed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_actions_one_target_action_idx" ON "operator_actions" USING btree ("target_type","target_id","action");--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_state_check" CHECK ("hr_reports"."state" in ('open', 'dismissed', 'removed'));--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_resolution_check" CHECK (("hr_reports"."state" = 'open' and "hr_reports"."dismissed_by" is null and "hr_reports"."dismissed_at" is null and "hr_reports"."removed_by" is null and "hr_reports"."removed_at" is null) or ("hr_reports"."state" = 'dismissed' and char_length("hr_reports"."dismissed_by") between 1 and 255 and "hr_reports"."dismissed_at" is not null and "hr_reports"."removed_by" is null and "hr_reports"."removed_at" is null) or ("hr_reports"."state" = 'removed' and "hr_reports"."dismissed_by" is null and "hr_reports"."dismissed_at" is null and char_length("hr_reports"."removed_by") between 1 and 255 and "hr_reports"."removed_at" is not null));--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_target_action_check" CHECK (("operator_actions"."target_type" = 'hr_report' and "operator_actions"."action" = 'dismissed') or ("operator_actions"."target_type" = 'message_removal' and "operator_actions"."action" = 'removed'));