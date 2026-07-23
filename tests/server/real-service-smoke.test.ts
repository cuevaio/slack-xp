import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  formatSmokeReport,
  inspectSmokeEnvironment,
  runSmokeContract,
  type SmokeScenarioAdapter,
  smokeCommandArgs,
} from "@/lib/smoke/contract";

const root = new URL("../..", import.meta.url);

const validEnvironment = {
  SMOKE_CONFIRMATION: "REAL-SERVICE-SMOKE",
  SMOKE_APP_ORIGIN: "https://smoke.example.com",
  NEXT_PUBLIC_PORTAL_KEY: "pk_portal_test",
  CLERK_SECRET_KEY: "sk_test_clerk_secret",
  SMOKE_CRON_SECRET: "cron-secret-for-smoke",
  SMOKE_NEW_HIRE_A_ID: "user_smoke_a",
  SMOKE_NEW_HIRE_B_ID: "user_smoke_b",
  SMOKE_OPERATOR_ID: "user_smoke_operator",
  SMOKE_RUN_DISPOSABLE_CLERK_LIFECYCLE: "false",
};

describe("manual real-service smoke contract", () => {
  test("preflights every required value before an adapter can mutate services", async () => {
    let calls = 0;
    const adapter: SmokeScenarioAdapter = {
      async run() {
        calls += 1;
        return "passed";
      },
      async cleanup() {
        calls += 1;
        return [];
      },
    };

    const report = await runSmokeContract({}, adapter);

    expect(report.exitCode).toBe(2);
    expect(calls).toBe(0);
    expect(report.preflightIssues).toContainAllValues([
      "CLERK_SECRET_KEY",
      "NEXT_PUBLIC_PORTAL_KEY",
      "SMOKE_APP_ORIGIN",
      "SMOKE_CONFIRMATION",
      "SMOKE_CRON_SECRET",
      "SMOKE_NEW_HIRE_A_ID",
      "SMOKE_NEW_HIRE_B_ID",
      "SMOKE_OPERATOR_ID",
    ]);
    expect(formatSmokeReport(report)).toContain(
      "Set or correct protected environment values",
    );
  });

  test("rejects unsafe origins, repeated identities, and unknown lifecycle gates", () => {
    const result = inspectSmokeEnvironment({
      ...validEnvironment,
      SMOKE_APP_ORIGIN: "http://smoke.example.com/path",
      SMOKE_NEW_HIRE_B_ID: "user_smoke_a",
      SMOKE_RUN_DISPOSABLE_CLERK_LIFECYCLE: "sometimes",
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.issues).toContainAllValues([
        "SMOKE_APP_ORIGIN",
        "SMOKE_NEW_HIRE_A_ID",
        "SMOKE_NEW_HIRE_B_ID",
        "SMOKE_OPERATOR_ID",
        "SMOKE_RUN_DISPOSABLE_CLERK_LIFECYCLE",
      ]);
    }
  });

  test("runs the deterministic scenario order and always cleans up", async () => {
    const calls: string[] = [];
    const adapter: SmokeScenarioAdapter = {
      async run(scenario) {
        calls.push(scenario);
        return scenario === "disposable-lifecycle" ? "skipped" : "passed";
      },
      async cleanup() {
        calls.push("cleanup");
        return [];
      },
    };

    const report = await runSmokeContract(validEnvironment, adapter);

    expect(report.exitCode).toBe(0);
    expect(calls).toEqual([
      "security-policy",
      "authenticated-identities",
      "office-day-outbox",
      "persistent-delivery",
      "presence-typing-unread",
      "reaction-replay",
      "reserved-sender-refusal",
      "profile-invalidation",
      "hr-reports-inbox",
      "removed-message",
      "termination-lifecycle",
      "disposable-lifecycle",
      "cleanup",
    ]);
    expect(report.checks.at(-1)).toMatchObject({
      id: "disposable-lifecycle",
      status: "skipped",
    });
  });

  test("stops dependent scenarios after failure and reports cleanup residuals", async () => {
    const calls: string[] = [];
    const adapter: SmokeScenarioAdapter = {
      async run(scenario) {
        calls.push(scenario);
        if (scenario === "persistent-delivery") {
          throw new Error("token=secret message=private reason=private");
        }
        return "passed";
      },
      async cleanup() {
        calls.push("cleanup");
        return ["clerk-profile-restore"];
      },
    };

    const report = await runSmokeContract(validEnvironment, adapter);
    const output = formatSmokeReport(report);

    expect(report.exitCode).toBe(1);
    expect(calls.at(-1)).toBe("cleanup");
    expect(output).not.toMatch(/token=secret|message=private|reason=private/);
    expect(output).toContain("clerk-profile-restore");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "presence-typing-unread",
        status: "not-run",
      }),
    );
  });

  test("assembles only fixed, non-secret command arguments", () => {
    expect(smokeCommandArgs({ preflight: true })).toEqual([
      "bun",
      "scripts/real-service-smoke.ts",
      "--preflight",
    ]);
    expect(
      smokeCommandArgs({ artifactPath: "artifacts/real-service-smoke.json" }),
    ).toEqual([
      "bun",
      "scripts/real-service-smoke.ts",
      "--artifact",
      "artifacts/real-service-smoke.json",
    ]);
  });

  test("the command preflight is actionable without live credentials", async () => {
    const subprocess = Bun.spawn({
      cmd: [
        "bun",
        "--no-env-file",
        "scripts/real-service-smoke.ts",
        "--preflight",
      ],
      cwd: root.pathname,
      env: { PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, output] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
    ]);

    expect(exitCode).toBe(2);
    expect(output).toContain("No service calls were made");
    expect(output).toContain("CLERK_SECRET_KEY");
    expect(output).not.toContain("undefined");
  });

  test("the workflow is protected, dispatch-only, and absent from ordinary CI", async () => {
    const [workflow, ci] = await Promise.all([
      readFile(
        new URL(".github/workflows/real-service-smoke.yml", root),
        "utf8",
      ),
      readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
    ]);

    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s+(pull_request|push|schedule):/m);
    expect(workflow).toContain("environment: real-service-smoke");
    expect(workflow).toContain("SMOKE_CONFIRMATION: REAL-SERVICE-SMOKE");
    expect(workflow).toContain("bun run smoke:real -- --preflight");
    expect(workflow).toContain("bun run smoke:real -- --artifact");
    expect(ci).not.toContain("smoke:real");
    expect(ci).not.toContain("real-service-smoke");
  });
});
