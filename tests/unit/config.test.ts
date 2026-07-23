import { describe, expect, test } from "bun:test";
import { detectAppEnvironment, readAppConfiguration } from "@/lib/config";

const developmentEnvironment = {
  APP_ORIGIN: "http://localhost:3000",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
  CLERK_SECRET_KEY: "sk_test_secret",
  CLERK_WEBHOOK_SECRET: "whsec_signing",
  NEXT_PUBLIC_PORTAL_KEY: "pk_portal_public",
  PORTAL_SECRET: "sk_portal_secret",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  CRON_SECRET: "cron_secret_for_tests",
};

describe("application configuration", () => {
  test("distinguishes all supported deployment environments", () => {
    expect(detectAppEnvironment({})).toBe("local");
    expect(detectAppEnvironment({ NODE_ENV: "test" })).toBe("test");
    expect(detectAppEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(detectAppEnvironment({ VERCEL_ENV: "production" })).toBe(
      "production",
    );
  });

  test("requires Clerk, Portal, and Neon in local and test environments", () => {
    expect(readAppConfiguration({}).status).toBe("incomplete");
    expect(
      readAppConfiguration({ ...developmentEnvironment, NODE_ENV: "test" }),
    ).toMatchObject({
      status: "ready",
      environment: "test",
    });
  });

  test("validates the fail-closed maintenance control without exposing values", () => {
    expect(
      readAppConfiguration({
        ...developmentEnvironment,
        PORTAL_MESSENGER_MAINTENANCE: "on",
      }),
    ).toMatchObject({
      status: "ready",
      values: { PORTAL_MESSENGER_MAINTENANCE: "on" },
    });
    expect(
      readAppConfiguration({
        ...developmentEnvironment,
        PORTAL_MESSENGER_MAINTENANCE: "maybe",
      }),
    ).toMatchObject({
      status: "incomplete",
      issues: [{ name: "PORTAL_MESSENGER_MAINTENANCE", reason: "invalid" }],
    });
  });

  test("reports variable names and reasons without returning invalid values", () => {
    const secret = "definitely-not-a-secret-key";
    const configuration = readAppConfiguration({
      APP_ENV: "preview",
      CLERK_SECRET_KEY: secret,
    });

    expect(configuration.status).toBe("incomplete");
    expect(JSON.stringify(configuration)).not.toContain(secret);
    if (configuration.status === "incomplete") {
      expect(configuration.issues).toContainEqual({
        name: "CLERK_SECRET_KEY",
        reason: "invalid",
      });
      expect(configuration.issues).toContainEqual({
        name: "DATABASE_URL",
        reason: "missing",
      });
    }
  });

  test("requires separate Clerk scopes and HTTPS production origin", () => {
    const shared = {
      APP_ORIGIN: "http://production.example.com",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CLERK_SECRET_KEY: "sk_test_secret",
      CLERK_WEBHOOK_SECRET: "whsec_signing",
      NEXT_PUBLIC_PORTAL_KEY: "pk_portal_public",
      PORTAL_SECRET: "sk_portal_secret",
      DATABASE_URL: "postgresql://user:password@example.com/database",
      CRON_SECRET: "cron_secret_for_tests",
    };
    const production = readAppConfiguration({
      ...shared,
      APP_ENV: "production",
    });

    expect(production).toMatchObject({ status: "incomplete" });
    if (production.status === "incomplete") {
      expect(production.issues).toContainEqual({
        name: "APP_ORIGIN",
        reason: "invalid",
      });
      expect(production.issues).toContainEqual({
        name: "CLERK_SECRET_KEY",
        reason: "invalid",
      });
    }
  });
});
