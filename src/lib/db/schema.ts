import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
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

export const hrReports = pgTable(
  "hr_reports",
  {
    reportId: text("report_id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => clerkProfiles.clerkUserId, { onDelete: "cascade" }),
    officeDay: text("office_day").notNull(),
    officeChannelId: text("office_channel_id").notNull(),
    messageId: text("message_id").notNull(),
    category: text("category").notNull(),
    state: text("state").default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "hr_reports_report_id_check",
      sql`char_length(${table.reportId}) between 1 and 255`,
    ),
    check(
      "hr_reports_reporter_id_check",
      sql`char_length(${table.reporterId}) between 1 and 255`,
    ),
    check(
      "hr_reports_office_day_check",
      sql`${table.officeDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      "hr_reports_stable_references_check",
      sql`char_length(${table.officeChannelId}) between 1 and 255 and char_length(${table.messageId}) between 1 and 255`,
    ),
    check(
      "hr_reports_category_check",
      sql`${table.category} in ('harassment-or-bullying', 'hate-or-discrimination', 'threatening-behavior', 'sexual-content')`,
    ),
    check(
      "hr_reports_state_check",
      sql`${table.state} in ('open', 'dismissed')`,
    ),
    uniqueIndex("hr_reports_one_open_message_per_reporter_idx")
      .on(table.reporterId, table.officeChannelId, table.messageId)
      .where(sql`${table.state} = 'open'`),
  ],
);

export const hrReportNotificationOutbox = pgTable(
  "hr_report_notification_outbox",
  {
    outboxId: text("outbox_id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .unique()
      .references(() => hrReports.reportId, { onDelete: "cascade" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "hr_report_notification_outbox_id_check",
      sql`char_length(${table.outboxId}) between 1 and 255`,
    ),
    index("hr_report_notification_outbox_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);
