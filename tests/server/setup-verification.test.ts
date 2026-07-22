import { describe, expect, test } from "bun:test";
import {
  formatSetupReport,
  runSetupVerification,
  type SetupVerifier,
} from "@/lib/setup/verification";

const liveEnvironment = {
  APP_ENV: "preview",
  SERVICE_MODE: "live",
  APP_ORIGIN: "https://preview.example.com",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
  CLERK_SECRET_KEY: "sk_test_secret",
  CLERK_WEBHOOK_SECRET: "whsec_signing",
  NEXT_PUBLIC_PORTAL_KEY: "pk_portal_public",
  PORTAL_SECRET: "sk_portal_secret",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  CRON_SECRET: "cron_secret_for_tests",
};

function passingVerifier(): SetupVerifier {
  return {
    async verifyNeon() {
      return { migrations: "current" };
    },
    async verifyClerk() {
      return { environment: "development" };
    },
    async verifyPortal() {
      return {
        anonymousRefused: true,
        authenticated: true,
        published: true,
        membership: true,
        mode: "standard",
        allowedOriginAccepted: true,
        unregisteredOriginRefused: true,
        persistedAfterReconnect: true,
      };
    },
  };
}

describe("fork setup verification", () => {
  test("proves a valid development service stack", async () => {
    const report = await runSetupVerification(
      liveEnvironment,
      passingVerifier(),
    );

    expect(report.exitCode).toBe(0);
    expect(report.checks.every((check) => check.status === "pass")).toBeTrue();
    expect(report.checks.map((check) => check.id)).toContainAllValues([
      "configuration",
      "neon-connectivity",
      "neon-migrations",
      "clerk-credentials",
      "clerk-webhook",
      "portal-anonymous-refusal",
      "portal-authenticated-publish",
      "portal-membership-mode",
      "portal-allowed-origin",
      "portal-unregistered-origin",
      "portal-persistence",
    ]);
  });

  test("distinguishes missing credentials from invalid configuration", async () => {
    const unavailable = await runSetupVerification(
      { APP_ENV: "preview", SERVICE_MODE: "live" },
      passingVerifier(),
    );
    expect(unavailable.exitCode).toBe(2);
    expect(unavailable.checks).toContainEqual(
      expect.objectContaining({
        id: "configuration",
        status: "unavailable",
      }),
    );

    const invalid = await runSetupVerification(
      { ...liveEnvironment, APP_ORIGIN: "not a URL" },
      passingVerifier(),
    );
    expect(invalid.exitCode).toBe(1);
    expect(invalid.checks).toContainEqual(
      expect.objectContaining({ id: "configuration", status: "fail" }),
    );
  });

  test("reports migration drift and service failure as corrective categories", async () => {
    const driftVerifier = passingVerifier();
    driftVerifier.verifyNeon = async () => ({ migrations: "drift" });
    const drift = await runSetupVerification(liveEnvironment, driftVerifier);
    expect(drift.exitCode).toBe(1);
    expect(drift.checks).toContainEqual(
      expect.objectContaining({ id: "neon-migrations", status: "fail" }),
    );

    const unavailableSecret = "postgresql://do-not-print";
    const failedVerifier = passingVerifier();
    failedVerifier.verifyNeon = async () => {
      throw new Error(`connection failed for ${unavailableSecret}`);
    };
    const failed = await runSetupVerification(liveEnvironment, failedVerifier);
    expect(failed.exitCode).toBe(1);
    expect(failed.checks).toContainEqual(
      expect.objectContaining({ id: "neon-connectivity", status: "fail" }),
    );
    expect(formatSetupReport(failed)).not.toContain(unavailableSecret);
  });

  test.each([
    ["anonymousRefused", "portal-anonymous-refusal"],
    ["authenticated", "portal-authenticated-publish"],
    ["published", "portal-authenticated-publish"],
    ["membership", "portal-membership-mode"],
    ["allowedOriginAccepted", "portal-allowed-origin"],
    ["unregisteredOriginRefused", "portal-unregistered-origin"],
    ["persistedAfterReconnect", "portal-persistence"],
  ] as const)("fails insecure Portal evidence: %s", async (field, checkId) => {
    const verifier = passingVerifier();
    const original = verifier.verifyPortal;
    verifier.verifyPortal = async () => ({
      ...(await original()),
      [field]: false,
    });

    const report = await runSetupVerification(liveEnvironment, verifier);
    expect(report.exitCode).toBe(1);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: checkId, status: "fail" }),
    );
  });

  test("fails when the required Portal channel mode is not standard", async () => {
    const verifier = passingVerifier();
    verifier.verifyPortal = async () => ({
      ...(await passingVerifier().verifyPortal()),
      mode: "broadcast",
    });

    const report = await runSetupVerification(liveEnvironment, verifier);
    expect(report.exitCode).toBe(1);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: "portal-membership-mode", status: "fail" }),
    );
  });

  test("production fails closed when required proof is unavailable", async () => {
    const verifier = passingVerifier();
    verifier.verifyPortal = async () => ({
      ...(await passingVerifier().verifyPortal()),
      unregisteredOriginRefused: null,
    });
    const report = await runSetupVerification(
      {
        ...liveEnvironment,
        APP_ENV: "production",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
        CLERK_SECRET_KEY: "sk_live_secret",
      },
      verifier,
    );

    expect(report.exitCode).toBe(1);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "portal-unregistered-origin",
        status: "unavailable",
      }),
    );
  });

  test("never renders secret values or verification message content", async () => {
    const report = await runSetupVerification(
      liveEnvironment,
      passingVerifier(),
    );
    const output = formatSetupReport(report);

    for (const value of [
      liveEnvironment.APP_ORIGIN,
      liveEnvironment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      liveEnvironment.CLERK_SECRET_KEY,
      liveEnvironment.CLERK_WEBHOOK_SECRET,
      liveEnvironment.NEXT_PUBLIC_PORTAL_KEY,
      liveEnvironment.PORTAL_SECRET,
      liveEnvironment.DATABASE_URL,
    ]) {
      expect(output).not.toContain(value);
    }
    expect(output).not.toContain("message content");
  });

  test("the command returns the unavailable exit code without credentials", async () => {
    const subprocess = Bun.spawn({
      cmd: ["bun", "scripts/setup-check.ts"],
      cwd: new URL("../..", import.meta.url).pathname,
      env: {
        PATH: process.env.PATH ?? "",
        APP_ENV: "preview",
        SERVICE_MODE: "live",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, output] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
    ]);

    expect(exitCode).toBe(2);
    expect(output).toContain("[UNAVAILABLE] Environment configuration");
    expect(output).not.toContain("undefined");
  });
});
