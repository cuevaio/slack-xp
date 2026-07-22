import { describe, expect, test } from "bun:test";
import {
  assertProductionSafety,
  detectAppEnvironment,
  readAppConfiguration,
} from "@/lib/config";

describe("application configuration", () => {
  test("distinguishes all supported deployment environments", () => {
    expect(detectAppEnvironment({})).toBe("local");
    expect(detectAppEnvironment({ NODE_ENV: "test" })).toBe("test");
    expect(detectAppEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(detectAppEnvironment({ VERCEL_ENV: "production" })).toBe(
      "production",
    );
  });

  test("uses deterministic mocks by default in local and test", () => {
    expect(readAppConfiguration({}).status).toBe("ready");
    expect(readAppConfiguration({ NODE_ENV: "test" })).toMatchObject({
      status: "ready",
      environment: "test",
      serviceMode: "mock",
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

  test("rejects mock mode in production builds and startup", () => {
    expect(() =>
      assertProductionSafety({ APP_ENV: "production", SERVICE_MODE: "mock" }),
    ).toThrow("refuses to build or start");
  });
});
