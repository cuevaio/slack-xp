import { describe, expect, test } from "bun:test";
import { createDatabase } from "@/lib/db/client";
import {
  buildOfficeDayQueries,
  buildHRReportInsertQuery,
  buildHRReportOutboxQuery,
  buildProfileOutboxQuery,
  buildProfileProjectionQuery,
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
});
