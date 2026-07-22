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

export const hrReports = pgTable(
  "hr_reports",
  {
    reportId: text("report_id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => clerkProfiles.clerkUserId, { onDelete: "cascade" }),
    subjectType: text("subject_type").default("message").notNull(),
    officeDay: text("office_day"),
    officeChannelId: text("office_channel_id"),
    messageId: text("message_id"),
    profileId: text("profile_id"),
    subjectNewHireId: text("subject_new_hire_id"),
    category: text("category").notNull(),
    state: text("state").default("open").notNull(),
    dismissedBy: text("dismissed_by"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    removedBy: text("removed_by"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
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
      sql`${table.officeDay} is null or ${table.officeDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      "hr_reports_subject_type_check",
      sql`${table.subjectType} in ('message', 'profile')`,
    ),
    check(
      "hr_reports_subject_context_check",
      sql`(${table.subjectType} = 'message' and ${table.officeDay} is not null and char_length(${table.officeChannelId}) between 1 and 255 and char_length(${table.messageId}) between 1 and 255 and ${table.profileId} is null) or (${table.subjectType} = 'profile' and ${table.officeDay} is null and ${table.officeChannelId} is null and ${table.messageId} is null and char_length(${table.profileId}) between 1 and 255)`,
    ),
    check(
      "hr_reports_category_check",
      sql`(${table.subjectType} = 'message' and ${table.category} in ('harassment-or-bullying', 'hate-or-discrimination', 'threatening-behavior', 'sexual-content')) or (${table.subjectType} = 'profile' and ${table.category} in ('abusive-or-hateful-name', 'abusive-or-explicit-picture', 'impersonation'))`,
    ),
    check(
      "hr_reports_state_check",
      sql`${table.state} in ('open', 'dismissed', 'removed', 'actioned')`,
    ),
    check(
      "hr_reports_resolution_check",
      sql`(${table.state} in ('open', 'actioned') and ${table.dismissedBy} is null and ${table.dismissedAt} is null and ${table.removedBy} is null and ${table.removedAt} is null) or (${table.state} = 'dismissed' and char_length(${table.dismissedBy}) between 1 and 255 and ${table.dismissedAt} is not null and ${table.removedBy} is null and ${table.removedAt} is null) or (${table.state} = 'removed' and ${table.dismissedBy} is null and ${table.dismissedAt} is null and char_length(${table.removedBy}) between 1 and 255 and ${table.removedAt} is not null)`,
    ),
    uniqueIndex("hr_reports_one_open_message_per_reporter_idx")
      .on(table.reporterId, table.officeChannelId, table.messageId)
      .where(sql`${table.subjectType} = 'message' and ${table.state} = 'open'`),
    uniqueIndex("hr_reports_one_open_profile_per_reporter_idx")
      .on(table.reporterId, table.profileId)
      .where(sql`${table.subjectType} = 'profile' and ${table.state} = 'open'`),
  ],
);

export const messageRemovals = pgTable(
  "message_removals",
  {
    removalId: text("removal_id").primaryKey(),
    officeDay: text("office_day").notNull(),
    officeChannelId: text("office_channel_id").notNull(),
    messageId: text("message_id").notNull(),
    removedBy: text("removed_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "message_removals_removal_id_check",
      sql`char_length(${table.removalId}) between 1 and 255`,
    ),
    check(
      "message_removals_office_day_check",
      sql`${table.officeDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      "message_removals_stable_references_check",
      sql`char_length(${table.officeChannelId}) between 1 and 255 and ${table.officeChannelId} like '%:' || ${table.officeDay} and char_length(${table.messageId}) between 1 and 255`,
    ),
    check(
      "message_removals_removed_by_check",
      sql`char_length(${table.removedBy}) between 1 and 255`,
    ),
    uniqueIndex("message_removals_message_uidx").on(
      table.officeChannelId,
      table.messageId,
    ),
    index("message_removals_channel_idx").on(
      table.officeChannelId,
      table.removedAt,
    ),
  ],
);

export const operatorActions = pgTable(
  "operator_actions",
  {
    actionId: text("action_id").primaryKey(),
    operatorId: text("operator_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    action: text("action").notNull(),
    privateNote: text("private_note"),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "operator_actions_action_id_check",
      sql`char_length(${table.actionId}) between 1 and 255`,
    ),
    check(
      "operator_actions_operator_id_check",
      sql`char_length(${table.operatorId}) between 1 and 255`,
    ),
    check(
      "operator_actions_kind_check",
      sql`(${table.targetType} = 'hr_report' and ${table.action} = 'dismissed') or (${table.targetType} = 'message_removal' and ${table.action} = 'removed') or (${table.targetType} = 'new_hire' and ${table.action} = 'sent_home')`,
    ),
    check(
      "operator_actions_private_note_check",
      sql`(${table.action} = 'dismissed' and (${table.privateNote} is null or char_length(${table.privateNote}) between 1 and 1000)) or (${table.action} in ('removed', 'sent_home') and char_length(${table.privateNote}) between 1 and 1000)`,
    ),
    uniqueIndex("operator_actions_one_report_dismissal_idx")
      .on(table.targetType, table.targetId, table.action)
      .where(
        sql`${table.targetType} = 'hr_report' and ${table.action} = 'dismissed'`,
      ),
    uniqueIndex("operator_actions_one_message_removal_idx")
      .on(table.targetType, table.targetId, table.action)
      .where(
        sql`${table.targetType} = 'message_removal' and ${table.action} = 'removed'`,
      ),
    index("operator_actions_target_idx").on(table.targetType, table.targetId),
  ],
);

export const messageRemovalInvalidationOutbox = pgTable(
  "message_removal_invalidation_outbox",
  {
    outboxId: text("outbox_id").primaryKey(),
    removalId: text("removal_id")
      .notNull()
      .unique()
      .references(() => messageRemovals.removalId, { onDelete: "cascade" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "message_removal_invalidation_outbox_id_check",
      sql`char_length(${table.outboxId}) between 1 and 255`,
    ),
    index("message_removal_invalidation_outbox_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

export const employmentActions = pgTable(
  "employment_actions",
  {
    actionId: text("action_id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    action: text("action").notNull(),
    operatorId: text("operator_id").notNull(),
    targetNewHireId: text("target_new_hire_id")
      .notNull()
      .references(() => clerkProfiles.clerkUserId, { onDelete: "cascade" }),
    officeDay: text("office_day").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reportId: text("report_id").references(() => hrReports.reportId, {
      onDelete: "set null",
    }),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "employment_actions_action_id_check",
      sql`char_length(${table.actionId}) between 1 and 255`,
    ),
    check(
      "employment_actions_request_id_check",
      sql`char_length(${table.requestId}) between 1 and 255`,
    ),
    check(
      "employment_actions_send_home_check",
      sql`${table.action} = 'sent_home'`,
    ),
    check(
      "employment_actions_office_day_check",
      sql`${table.officeDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      "employment_actions_expiry_check",
      sql`${table.expiresAt} > ${table.actedAt} and ${table.expiresAt} = (${table.officeDay}::date + interval '1 day')::timestamptz`,
    ),
    uniqueIndex("employment_actions_one_send_home_per_day_idx").on(
      table.action,
      table.targetNewHireId,
      table.officeDay,
    ),
    index("employment_actions_active_idx").on(
      table.targetNewHireId,
      table.expiresAt,
    ),
  ],
);

export const employmentEffectOutbox = pgTable(
  "employment_effect_outbox",
  {
    actionId: text("action_id")
      .primaryKey()
      .references(() => employmentActions.actionId, { onDelete: "cascade" }),
    bansAppliedAt: timestamp("bans_applied_at", { withTimezone: true }),
    publicEventPublishedAt: timestamp("public_event_published_at", {
      withTimezone: true,
    }),
    invalidationPublishedAt: timestamp("invalidation_published_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("employment_effect_outbox_pending_idx").on(table.createdAt),
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
