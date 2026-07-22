ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_stable_references_check";--> statement-breakpoint
ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_office_day_check";--> statement-breakpoint
ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_category_check";--> statement-breakpoint
DROP INDEX "hr_reports_one_open_message_per_reporter_idx";--> statement-breakpoint
ALTER TABLE "hr_reports" ALTER COLUMN "office_day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_reports" ALTER COLUMN "office_channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_reports" ALTER COLUMN "message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "subject_type" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "profile_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_reports_one_open_profile_per_reporter_idx" ON "hr_reports" USING btree ("reporter_id","profile_id") WHERE "hr_reports"."subject_type" = 'profile' and "hr_reports"."state" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "hr_reports_one_open_message_per_reporter_idx" ON "hr_reports" USING btree ("reporter_id","office_channel_id","message_id") WHERE "hr_reports"."subject_type" = 'message' and "hr_reports"."state" = 'open';--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_subject_type_check" CHECK ("hr_reports"."subject_type" in ('message', 'profile'));--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_subject_context_check" CHECK (("hr_reports"."subject_type" = 'message' and "hr_reports"."office_day" is not null and char_length("hr_reports"."office_channel_id") between 1 and 255 and char_length("hr_reports"."message_id") between 1 and 255 and "hr_reports"."profile_id" is null) or ("hr_reports"."subject_type" = 'profile' and "hr_reports"."office_day" is null and "hr_reports"."office_channel_id" is null and "hr_reports"."message_id" is null and char_length("hr_reports"."profile_id") between 1 and 255));--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_office_day_check" CHECK ("hr_reports"."office_day" is null or "hr_reports"."office_day" ~ '^\d{4}-\d{2}-\d{2}$');--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_category_check" CHECK (("hr_reports"."subject_type" = 'message' and "hr_reports"."category" in ('harassment-or-bullying', 'hate-or-discrimination', 'threatening-behavior', 'sexual-content')) or ("hr_reports"."subject_type" = 'profile' and "hr_reports"."category" in ('abusive-or-hateful-name', 'abusive-or-explicit-picture', 'impersonation')));