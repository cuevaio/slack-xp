CREATE TABLE "employment_actions" (
	"action_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"operator_id" text NOT NULL,
	"target_new_hire_id" text NOT NULL,
	"office_day" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"report_id" text,
	"acted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_actions_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "employment_actions_action_id_check" CHECK (char_length("employment_actions"."action_id") between 1 and 255),
	CONSTRAINT "employment_actions_request_id_check" CHECK (char_length("employment_actions"."request_id") between 1 and 255),
	CONSTRAINT "employment_actions_send_home_check" CHECK ("employment_actions"."action" = 'sent_home'),
	CONSTRAINT "employment_actions_office_day_check" CHECK ("employment_actions"."office_day" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "employment_actions_expiry_check" CHECK ("employment_actions"."expires_at" > "employment_actions"."acted_at" and "employment_actions"."expires_at" = ("employment_actions"."office_day"::date + interval '1 day')::timestamptz)
);
--> statement-breakpoint
CREATE TABLE "employment_effect_outbox" (
	"action_id" text PRIMARY KEY NOT NULL,
	"bans_applied_at" timestamp with time zone,
	"public_event_published_at" timestamp with time zone,
	"invalidation_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_state_check";--> statement-breakpoint
ALTER TABLE "hr_reports" DROP CONSTRAINT "hr_reports_resolution_check";--> statement-breakpoint
ALTER TABLE "operator_actions" DROP CONSTRAINT "operator_actions_target_action_check";--> statement-breakpoint
ALTER TABLE "operator_actions" DROP CONSTRAINT "operator_actions_private_note_check";--> statement-breakpoint
DROP INDEX "operator_actions_one_target_action_idx";--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "subject_new_hire_id" text;--> statement-breakpoint
UPDATE "hr_reports" SET "subject_new_hire_id" = "profile_id" WHERE "subject_type" = 'profile' AND "subject_new_hire_id" IS NULL;--> statement-breakpoint
ALTER TABLE "employment_actions" ADD CONSTRAINT "employment_actions_target_new_hire_id_clerk_profiles_clerk_user_id_fk" FOREIGN KEY ("target_new_hire_id") REFERENCES "public"."clerk_profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_actions" ADD CONSTRAINT "employment_actions_report_id_hr_reports_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."hr_reports"("report_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_effect_outbox" ADD CONSTRAINT "employment_effect_outbox_action_id_employment_actions_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."employment_actions"("action_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employment_actions_one_send_home_per_day_idx" ON "employment_actions" USING btree ("action","target_new_hire_id","office_day");--> statement-breakpoint
CREATE INDEX "employment_actions_active_idx" ON "employment_actions" USING btree ("target_new_hire_id","expires_at");--> statement-breakpoint
CREATE INDEX "employment_effect_outbox_pending_idx" ON "employment_effect_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_actions_one_report_dismissal_idx" ON "operator_actions" USING btree ("target_type","target_id","action") WHERE "operator_actions"."target_type" = 'hr_report' and "operator_actions"."action" = 'dismissed';--> statement-breakpoint
CREATE UNIQUE INDEX "operator_actions_one_message_removal_idx" ON "operator_actions" USING btree ("target_type","target_id","action") WHERE "operator_actions"."target_type" = 'message_removal' and "operator_actions"."action" = 'removed';--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_state_check" CHECK ("hr_reports"."state" in ('open', 'dismissed', 'removed', 'actioned'));--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_resolution_check" CHECK (("hr_reports"."state" in ('open', 'actioned') and "hr_reports"."dismissed_by" is null and "hr_reports"."dismissed_at" is null and "hr_reports"."removed_by" is null and "hr_reports"."removed_at" is null) or ("hr_reports"."state" = 'dismissed' and char_length("hr_reports"."dismissed_by") between 1 and 255 and "hr_reports"."dismissed_at" is not null and "hr_reports"."removed_by" is null and "hr_reports"."removed_at" is null) or ("hr_reports"."state" = 'removed' and "hr_reports"."dismissed_by" is null and "hr_reports"."dismissed_at" is null and char_length("hr_reports"."removed_by") between 1 and 255 and "hr_reports"."removed_at" is not null));--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_kind_check" CHECK (("operator_actions"."target_type" = 'hr_report' and "operator_actions"."action" = 'dismissed') or ("operator_actions"."target_type" = 'message_removal' and "operator_actions"."action" = 'removed') or ("operator_actions"."target_type" = 'new_hire' and "operator_actions"."action" = 'sent_home'));--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_private_note_check" CHECK (("operator_actions"."action" = 'dismissed' and ("operator_actions"."private_note" is null or char_length("operator_actions"."private_note") between 1 and 1000)) or ("operator_actions"."action" in ('removed', 'sent_home') and char_length("operator_actions"."private_note") between 1 and 1000));
