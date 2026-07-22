import { describe, expect, test } from "bun:test";

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
});
