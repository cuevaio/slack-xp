CREATE TABLE "operator_actions" (
	"action_id" text PRIMARY KEY NOT NULL,
	"operator_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"private_note" text,
	"acted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_actions_action_id_check" CHECK (char_length("operator_actions"."action_id") between 1 and 255),
	CONSTRAINT "operator_actions_operator_id_check" CHECK (char_length("operator_actions"."operator_id") between 1 and 255),
	CONSTRAINT "operator_actions_hr_report_dismissal_check" CHECK ("operator_actions"."target_type" = 'hr_report' and "operator_actions"."action" = 'dismissed'),
	CONSTRAINT "operator_actions_private_note_check" CHECK ("operator_actions"."private_note" is null or char_length("operator_actions"."private_note") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "dismissed_by" text;--> statement-breakpoint
ALTER TABLE "hr_reports" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_target_id_hr_reports_report_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."hr_reports"("report_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_actions_one_report_dismissal_idx" ON "operator_actions" USING btree ("target_type","target_id","action");--> statement-breakpoint
CREATE INDEX "operator_actions_target_idx" ON "operator_actions" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "hr_reports" ADD CONSTRAINT "hr_reports_resolution_check" CHECK (("hr_reports"."state" = 'open' and "hr_reports"."dismissed_by" is null and "hr_reports"."dismissed_at" is null) or ("hr_reports"."state" = 'dismissed' and char_length("hr_reports"."dismissed_by") between 1 and 255 and "hr_reports"."dismissed_at" is not null));