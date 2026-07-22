import { describe, expect, test } from "bun:test";
import { createDatabase } from "@/lib/db/client";
import { buildProfileProjectionQuery } from "@/lib/onboarding/neon";

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
});
