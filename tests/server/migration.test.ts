import { describe, expect, test } from "bun:test";
import { createDatabase } from "@/lib/db/client";
import {
  buildHRReportDismissQuery,
  buildHRReportInsertQuery,
  buildHRReportOutboxQuery,
  buildMessageRemovalAuditQuery,
  buildMessageRemovalInsertQuery,
  buildMessageRemovalOutboxQuery,
  buildMessageRemovalReportResolutionQuery,
  buildOfficeDayQueries,
  buildOperatorActionInsertQuery,
  buildProfileOutboxQuery,
  buildProfileProjectionQuery,
  buildSendHomeQueries,
} from "@/lib/onboarding/neon";

describe("initial Neon migration", () => {
  test("contains constrained Clerk profile and onboarding records only", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0000_onboard_new_hires.sql", import.meta.url),
    ).text();

    expect(migration).toContain('CREATE TABLE "clerk_profiles"');
    expect(migration).toContain('CREATE TABLE "new_hire_onboarding"');
    expect(
      migration.match(/"clerk_user_id" text PRIMARY KEY NOT NULL/g),
    ).toHaveLength(2);
    expect(migration).toContain("CHECK");
    expect(migration).toContain("completed_at");
    expect(migration).toContain("deleted_at");
    expect(migration).toContain("is null");
    expect(migration).not.toMatch(/message[_ ]?(body|content)/i);
  });

  test("orders profile upserts in the database without rewriting exact replay", () => {
    const query = buildProfileProjectionQuery(
      createDatabase("postgresql://test:test@localhost/test"),
      {
        clerkUserId: "user_sql_contract",
        firstName: "Pat",
        lastName: "Pending",
        displayName: "Pat Pending",
        imageUrl: null,
        sourceVersion: 20,
      },
    ).toSQL();

    expect(query.sql).toContain("on conflict");
    expect(query.sql).toContain("excluded.source_version");
    expect(query.sql).toContain("is distinct from excluded.display_name");
    expect(query.sql).toContain('returning "clerk_user_id"');
  });

  test("adds a stable-reference-only profile publishing outbox", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0001_keen_penance.sql", import.meta.url),
    ).text();
    expect(migration).toContain('CREATE TABLE "profile_invalidation_outbox"');
    expect(migration).toContain('"event_key" text PRIMARY KEY');
    expect(migration).toContain('"profile_id" text NOT NULL');
    expect(migration).toContain('"published_at" timestamp with time zone');
    expect(migration).not.toMatch(
      /display_name|image_url|first_name|last_name/,
    );
    expect(migration).not.toMatch(/message[_ ]?(body|content)/i);

    const query = buildProfileOutboxQuery(
      createDatabase("postgresql://test:test@localhost/test"),
      {
        clerkUserId: "user_outbox_contract",
        firstName: "Pat",
        lastName: "Pending",
        displayName: "Pat Pending",
        imageUrl: null,
        sourceVersion: 20,
      },
      new Date("2026-07-22T12:00:00.000Z"),
    ).toSQL();
    expect(query.sql).toContain("insert into");
    expect(query.sql).toContain("select");
    expect(query.sql).toContain("source_version");
    expect(query.sql).toContain("on conflict");
  });

  test("adds constrained Office Day and retry-state outbox records", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0002_productive_kitty_pryde.sql", import.meta.url),
    ).text();
    expect(migration).toContain('CREATE TABLE "office_days"');
    expect(migration).toContain('CREATE TABLE "scripted_system_event_outbox"');
    expect(migration).toContain('"event_key" text PRIMARY KEY');
    expect(migration).toContain('"attempt_count" integer DEFAULT 0 NOT NULL');
    expect(migration).toContain('"last_attempt_at" timestamp with time zone');
    expect(migration).toContain('"published_at" timestamp with time zone');
    expect(migration).toContain(
      'UNIQUE INDEX "scripted_system_event_outbox_day_script_uidx"',
    );
    expect(migration).not.toMatch(/message[_ ]?(body|content)/i);

    const queries = buildOfficeDayQueries(
      createDatabase("postgresql://test:test@localhost/test"),
      "2026-07-22",
      new Date("2026-07-22T00:00:00.000Z"),
    );
    expect(queries).toHaveLength(2);
    expect(
      queries.every((query) => query.toSQL().sql.includes("on conflict")),
    ).toBe(true);
  });

  test("adds transactional body-free HR Report workflow records", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0003_report_messages_to_hr.sql", import.meta.url),
    ).text();
    expect(migration).toContain('CREATE TABLE "hr_reports"');
    expect(migration).toContain('CREATE TABLE "hr_report_notification_outbox"');
    expect(migration).toContain('"reporter_id" text NOT NULL');
    expect(migration).toContain('"office_channel_id" text NOT NULL');
    expect(migration).toContain('"message_id" text NOT NULL');
    expect(migration).toContain('"category" text NOT NULL');
    expect(migration).toContain("\"state\" text DEFAULT 'open' NOT NULL");
    expect(migration).toContain("hr_reports_one_open_message_per_reporter_idx");
    expect(migration).not.toMatch(
      /message[_ ]?(body|content)|preview|presence|typing|reaction/iu,
    );

    const database = createDatabase("postgresql://test:test@localhost/test");
    const input = {
      reportId: "report-sql-contract",
      reporterId: "user-reporter",
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-17",
      subjectType: "message" as const,
      category: "harassment-or-bullying" as const,
      createdAt: new Date("2026-07-22T12:00:00.000Z"),
    };
    const reportQuery = buildHRReportInsertQuery(database, input).toSQL();
    const outboxQuery = buildHRReportOutboxQuery(database, input).toSQL();
    expect(reportQuery.sql).toContain("on conflict");
    expect(reportQuery.sql).toContain("where");
    expect(reportQuery.sql).toContain('returning "report_id"');
    expect(outboxQuery.sql).toContain("insert into");
    expect(outboxQuery.sql).toContain("select");
    expect(outboxQuery.sql).toContain("on conflict");
  });

  test("extends HR Reports with type-safe profile references and distinct open uniqueness", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0004_report_profiles_to_hr.sql", import.meta.url),
    ).text();
    expect(migration).toContain('"subject_type" text');
    expect(migration).toContain('"profile_id" text');
    expect(migration).toContain("hr_reports_subject_context_check");
    expect(migration).toContain("hr_reports_one_open_profile_per_reporter_idx");
    expect(migration).toContain("hr_reports_one_open_message_per_reporter_idx");
    expect(migration).not.toMatch(
      /display_name|image_url|first_name|last_name|picture_url/iu,
    );

    const query = buildHRReportInsertQuery(
      createDatabase("postgresql://test:test@localhost/test"),
      {
        reportId: "profile-report-sql-contract",
        reporterId: "user-reporter",
        subjectType: "profile",
        profileId: "user-profile-subject",
        category: "abusive-or-hateful-name",
        createdAt: new Date("2026-07-22T12:00:00.000Z"),
      },
    ).toSQL();
    expect(query.sql).toContain("on conflict");
    expect(query.sql).toContain('"profile_id"');
    expect(query.sql).toContain('"subject_type"');
    expect(query.sql).toContain('returning "report_id"');
  });

  test("adds one-way HR Report dismissal and private Operator audits", async () => {
    const migration = await Bun.file(
      new URL(
        "../../drizzle/0005_review_hr_reports_inline.sql",
        import.meta.url,
      ),
    ).text();
    expect(migration).toContain('CREATE TABLE "operator_actions"');
    expect(migration).toContain('"dismissed_by" text');
    expect(migration).toContain('"dismissed_at" timestamp with time zone');
    expect(migration).toContain("hr_reports_resolution_check");
    expect(migration).toContain("operator_actions_one_report_dismissal_idx");
    expect(migration).toContain('"private_note" text');
    expect(migration).not.toMatch(/message[_ ]?(body|content)|preview/iu);

    const database = createDatabase("postgresql://test:test@localhost/test");
    const input = {
      actionId: "action-sql-contract",
      reportId: "report-sql-contract",
      operatorId: "user-operator",
      privateNote: "Reviewed privately.",
      actedAt: new Date("2026-07-22T12:05:00.000Z"),
    };
    const dismissal = buildHRReportDismissQuery(database, input).toSQL();
    const audit = buildOperatorActionInsertQuery(database, input).toSQL();
    expect(dismissal.sql).toContain('"state" =');
    expect(dismissal.sql).toContain('"dismissed_by" is null');
    expect(dismissal.sql).toContain('returning "report_id"');
    expect(audit.sql).toContain("insert into");
    expect(audit.sql).toContain("select");
    expect(audit.sql).toContain("on conflict");
  });

  test("adds transactional body-free Removed Message projection, audit, and invalidation outbox", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0006_chubby_omega_red.sql", import.meta.url),
    ).text();
    expect(migration).toContain('CREATE TABLE "message_removals"');
    expect(migration).toContain(
      'CREATE TABLE "message_removal_invalidation_outbox"',
    );
    expect(migration).toContain('"office_channel_id" text NOT NULL');
    expect(migration).toContain('"message_id" text NOT NULL');
    expect(migration).toContain('"removed_by" text NOT NULL');
    expect(migration).toContain('"removed_at" timestamp with time zone');
    expect(migration).toContain("message_removals_message_uidx");
    expect(migration).toContain("operator_actions_target_action_check");
    expect(migration).toContain("'message_removal'");
    expect(migration).not.toMatch(
      /message[_ ]?(body|content)|preview|presence|typing|reaction/iu,
    );

    const database = createDatabase("postgresql://test:test@localhost/test");
    const input = {
      removalId: "removal-sql-contract",
      actionId: "action-removal-sql-contract",
      operatorId: "user-operator",
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-20",
      privateReason: "Private audit reason.",
      removedAt: new Date("2026-07-22T12:05:00.000Z"),
    };
    const queries = [
      buildMessageRemovalInsertQuery(database, input),
      buildMessageRemovalReportResolutionQuery(database, input),
      buildMessageRemovalAuditQuery(database, input),
      buildMessageRemovalOutboxQuery(database, input),
    ].map((query) => query.toSQL().sql);
    expect(queries[0]).toContain("on conflict");
    expect(queries[0]).toContain('returning "removal_id"');
    expect(queries[1]).toContain('"state" =');
    expect(queries[1]).toContain("exists");
    expect(queries[2]).toContain("insert into");
    expect(queries[2]).toContain("select");
    expect(queries[3]).toContain("insert into");
    expect(queries[3]).toContain("select");
  });

  test("adds expiring Send Home actions with transactional private audit and effect outbox", async () => {
    const migration = await Bun.file(
      new URL("../../drizzle/0007_send_home_new_hire.sql", import.meta.url),
    ).text();
    expect(migration).toContain('CREATE TABLE "employment_actions"');
    expect(migration).toContain('CREATE TABLE "employment_effect_outbox"');
    expect(migration).toContain(
      '"expires_at" timestamp with time zone NOT NULL',
    );
    expect(migration).toContain("employment_actions_one_send_home_per_day_idx");
    expect(migration).toContain("public_event_published_at");
    expect(migration).toContain("invalidation_published_at");
    expect(migration).toContain("bans_applied_at");

    const queries = buildSendHomeQueries(
      createDatabase("postgresql://test:test@localhost/test"),
      {
        actionId: "action-send-home-sql",
        requestId: "request-send-home-sql",
        operatorId: "user-operator",
        targetNewHireId: "user-target",
        officeDay: "2026-07-22",
        expiresAt: new Date("2026-07-23T00:00:00.000Z"),
        reportId: "report-send-home-sql",
        privateReason: "Private audit reason.",
        actedAt: new Date("2026-07-22T20:00:00.000Z"),
      },
    );
    expect(queries.insertAction.toSQL().sql).toContain(
      "on conflict do nothing",
    );
    expect(queries.insertAudit.toSQL().sql).toContain("operator_actions");
    expect(queries.insertOutbox.toSQL().sql).toContain(
      "employment_effect_outbox",
    );
    expect(queries.transitionReport.toSQL().sql).toContain('"state" =');
    expect(queries.insertOutbox.toSQL().sql).not.toContain(
      "Private audit reason",
    );
  });
});
