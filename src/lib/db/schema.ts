import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export const profileInvalidationOutbox = pgTable(
  "profile_invalidation_outbox",
  {
    eventKey: text("event_key").primaryKey(),
    profileId: text("profile_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "profile_invalidation_outbox_event_key_check",
      sql`char_length(${table.eventKey}) between 1 and 255`,
    ),
    check(
      "profile_invalidation_outbox_profile_id_check",
      sql`char_length(${table.profileId}) between 1 and 255`,
    ),
    index("profile_invalidation_outbox_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

export const officeDays = pgTable(
  "office_days",
  {
    officeDay: text("office_day").primaryKey(),
    seededAt: timestamp("seeded_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "office_days_office_day_check",
      sql`${table.officeDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
  ],
);

export const scriptedSystemEventOutbox = pgTable(
  "scripted_system_event_outbox",
  {
    eventKey: text("event_key").primaryKey(),
    officeDay: text("office_day")
      .notNull()
      .references(() => officeDays.officeDay, { onDelete: "cascade" }),
    scriptId: text("script_id").notNull(),
    channelId: text("channel_id").notNull(),
    characterId: text("character_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "scripted_system_event_outbox_event_key_check",
      sql`char_length(${table.eventKey}) between 1 and 255`,
    ),
    check(
      "scripted_system_event_outbox_script_id_check",
      sql`char_length(${table.scriptId}) between 1 and 80`,
    ),
    check(
      "scripted_system_event_outbox_channel_id_check",
      sql`char_length(${table.channelId}) between 1 and 255`,
    ),
    check(
      "scripted_system_event_outbox_character_id_check",
      sql`${table.characterId} like 'office-character:%'`,
    ),
    check(
      "scripted_system_event_outbox_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "scripted_system_event_outbox_publish_attempt_check",
      sql`${table.publishedAt} is null or ${table.lastAttemptAt} is not null`,
    ),
    uniqueIndex("scripted_system_event_outbox_day_script_uidx").on(
      table.officeDay,
      table.scriptId,
    ),
    index("scripted_system_event_outbox_pending_idx")
      .on(table.dueAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);
