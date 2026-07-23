import { describe, expect, test } from "bun:test";
import {
  createDeploymentDryRun,
  validateReleasePackage,
} from "@/lib/release-docs";

const repositoryRoot = new URL("../..", import.meta.url).pathname;

describe("fork-and-deploy release package", () => {
  test("keeps documentation links and deployment configuration consistent", async () => {
    const report = await validateReleasePackage(repositoryRoot);

    expect(report.checks).toHaveLength(7);
    expect(report.checks.every((check) => check.status === "pass")).toBeTrue();
    expect(report.exitCode).toBe(0);
  });

  test("renders a documentation-only deployment rehearsal", async () => {
    const dryRun = await createDeploymentDryRun(repositoryRoot);

    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.requiresCredentials).toBeFalse();
    expect(dryRun.phases).toEqual([
      "Fork and choose a production region",
      "Create separate development resources",
      "Verify the development stack",
      "Create separate production resources",
      "Deploy production configuration and migrations",
      "Verify the production deployment",
    ]);
  });

  test("the CLI dry run makes no credential values necessary", async () => {
    const subprocess = Bun.spawn({
      cmd: [
        "bun",
        "--no-env-file",
        "scripts/release-docs-check.ts",
        "--dry-run",
      ],
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("No service credentials were read");
    expect(stdout).toContain("[PASS] Documentation links");
    expect(stdout).not.toContain("sk_");
    expect(stdout).not.toContain("postgresql://");
  });
});
