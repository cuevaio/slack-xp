CREATE TABLE "employment_reinstatements" (
	"reinstatement_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"termination_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"target_new_hire_id" text NOT NULL,
	"reinstated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_reinstatements_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "employment_reinstatements_termination_id_unique" UNIQUE("termination_id"),
	CONSTRAINT "employment_reinstatements_id_check" CHECK (char_length("employment_reinstatements"."reinstatement_id") between 1 and 255 and char_length("employment_reinstatements"."request_id") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "employment_termination_effect_outbox" (
	"effect_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"termination_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"target_new_hire_id" text NOT NULL,
	"office_day" text NOT NULL,
	"acted_at" timestamp with time zone NOT NULL,
	"portal_access_reconciled_at" timestamp with time zone,
	"public_event_published_at" timestamp with time zone,
	"invalidation_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_termination_effect_kind_check" CHECK ("employment_termination_effect_outbox"."action" in ('terminated', 'reinstated') and "employment_termination_effect_outbox"."office_day" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "employment_terminations" (
	"termination_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"target_new_hire_id" text NOT NULL,
	"report_id" text,
	"terminated_at" timestamp with time zone NOT NULL,
	"reinstated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_terminations_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "employment_terminations_id_check" CHECK (char_length("employment_terminations"."termination_id") between 1 and 255 and char_length("employment_terminations"."request_id") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "operator_actions" DROP CONSTRAINT "operator_actions_kind_check";--> statement-breakpoint
ALTER TABLE "operator_actions" DROP CONSTRAINT "operator_actions_private_note_check";--> statement-breakpoint
ALTER TABLE "employment_reinstatements" ADD CONSTRAINT "employment_reinstatements_termination_id_employment_terminations_termination_id_fk" FOREIGN KEY ("termination_id") REFERENCES "public"."employment_terminations"("termination_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_reinstatements" ADD CONSTRAINT "employment_reinstatements_target_new_hire_id_clerk_profiles_clerk_user_id_fk" FOREIGN KEY ("target_new_hire_id") REFERENCES "public"."clerk_profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_termination_effect_outbox" ADD CONSTRAINT "employment_termination_effect_outbox_termination_id_employment_terminations_termination_id_fk" FOREIGN KEY ("termination_id") REFERENCES "public"."employment_terminations"("termination_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terminations" ADD CONSTRAINT "employment_terminations_target_new_hire_id_clerk_profiles_clerk_user_id_fk" FOREIGN KEY ("target_new_hire_id") REFERENCES "public"."clerk_profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terminations" ADD CONSTRAINT "employment_terminations_report_id_hr_reports_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."hr_reports"("report_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employment_reinstatements_target_idx" ON "employment_reinstatements" USING btree ("target_new_hire_id","reinstated_at");--> statement-breakpoint
CREATE INDEX "employment_termination_effect_pending_idx" ON "employment_termination_effect_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_terminations_one_active_idx" ON "employment_terminations" USING btree ("target_new_hire_id") WHERE "employment_terminations"."reinstated_at" is null;--> statement-breakpoint
CREATE INDEX "employment_terminations_target_idx" ON "employment_terminations" USING btree ("target_new_hire_id","terminated_at");--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_kind_check" CHECK (("operator_actions"."target_type" = 'hr_report' and "operator_actions"."action" = 'dismissed') or ("operator_actions"."target_type" = 'message_removal' and "operator_actions"."action" = 'removed') or ("operator_actions"."target_type" = 'new_hire' and "operator_actions"."action" in ('sent_home', 'terminated', 'reinstated')));--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_private_note_check" CHECK (("operator_actions"."action" = 'dismissed' and ("operator_actions"."private_note" is null or char_length("operator_actions"."private_note") between 1 and 1000)) or ("operator_actions"."action" in ('removed', 'sent_home', 'terminated', 'reinstated') and char_length("operator_actions"."private_note") between 1 and 1000));