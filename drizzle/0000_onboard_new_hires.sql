CREATE TABLE "clerk_profiles" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"display_name" text,
	"image_url" text,
	"source_version" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clerk_profiles_clerk_user_id_check" CHECK (char_length("clerk_profiles"."clerk_user_id") between 1 and 255),
	CONSTRAINT "clerk_profiles_active_or_tombstoned_check" CHECK (("clerk_profiles"."deleted_at" is null and "clerk_profiles"."first_name" is not null and "clerk_profiles"."last_name" is not null and "clerk_profiles"."display_name" is not null and char_length("clerk_profiles"."display_name") between 1 and 80) or ("clerk_profiles"."deleted_at" is not null and "clerk_profiles"."first_name" is null and "clerk_profiles"."last_name" is null and "clerk_profiles"."display_name" is null and "clerk_profiles"."image_url" is null))
);
--> statement-breakpoint
CREATE TABLE "new_hire_onboarding" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"job_title" text NOT NULL,
	"profile_confirmed_at" timestamp with time zone,
	"conduct_accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "new_hire_onboarding_job_title_check" CHECK (char_length("new_hire_onboarding"."job_title") between 1 and 120),
	CONSTRAINT "new_hire_onboarding_completion_check" CHECK ("new_hire_onboarding"."completed_at" is null or ("new_hire_onboarding"."profile_confirmed_at" is not null and "new_hire_onboarding"."conduct_accepted_at" is not null)),
	CONSTRAINT "new_hire_onboarding_conduct_order_check" CHECK ("new_hire_onboarding"."conduct_accepted_at" is null or "new_hire_onboarding"."profile_confirmed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "new_hire_onboarding" ADD CONSTRAINT "new_hire_onboarding_clerk_user_id_clerk_profiles_clerk_user_id_fk" FOREIGN KEY ("clerk_user_id") REFERENCES "public"."clerk_profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;