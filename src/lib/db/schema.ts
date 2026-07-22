import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const clerkProfiles = pgTable(
  "clerk_profiles",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    displayName: text("display_name"),
    imageUrl: text("image_url"),
    sourceVersion: bigint("source_version", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "clerk_profiles_clerk_user_id_check",
      sql`char_length(${table.clerkUserId}) between 1 and 255`,
    ),
    check(
      "clerk_profiles_active_or_tombstoned_check",
      sql`(${table.deletedAt} is null and ${table.firstName} is not null and ${table.lastName} is not null and ${table.displayName} is not null and char_length(${table.displayName}) between 1 and 80) or (${table.deletedAt} is not null and ${table.firstName} is null and ${table.lastName} is null and ${table.displayName} is null and ${table.imageUrl} is null)`,
    ),
  ],
);

export const newHireOnboarding = pgTable(
  "new_hire_onboarding",
  {
    clerkUserId: text("clerk_user_id")
      .primaryKey()
      .references(() => clerkProfiles.clerkUserId, { onDelete: "cascade" }),
    jobTitle: text("job_title").notNull(),
    profileConfirmedAt: timestamp("profile_confirmed_at", {
      withTimezone: true,
    }),
    conductAcceptedAt: timestamp("conduct_accepted_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "new_hire_onboarding_job_title_check",
      sql`char_length(${table.jobTitle}) between 1 and 120`,
    ),
    check(
      "new_hire_onboarding_completion_check",
      sql`${table.completedAt} is null or (${table.profileConfirmedAt} is not null and ${table.conductAcceptedAt} is not null)`,
    ),
    check(
      "new_hire_onboarding_conduct_order_check",
      sql`${table.conductAcceptedAt} is null or ${table.profileConfirmedAt} is not null`,
    ),
  ],
);
