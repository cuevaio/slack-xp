import { describe, expect, test } from "bun:test";
import packageJson from "../../package.json";
import portalConfig from "../../portal.config";
import vercelConfig from "../../vercel.json";

describe("deployed Portal customer contract", () => {
  test("allows anonymous reads but not anonymous publishing", () => {
    for (const channel of [
      "general:*",
      "watercooler:*",
      "tech-support:*",
      "urgent:*",
    ]) {
      expect(portalConfig.channels?.[channel]?.anonymous).toBe(true);
    }
    expect(portalConfig.channels?.["all-hands:*"]?.anonymous).toBe(true);
    expect(portalConfig.channels?.["all-hands:*"]?.mode).toBe("broadcast");
    expect(portalConfig.channels?.["office-events:*"]).toEqual({
      anonymous: false,
    });
    expect(portalConfig.channels?.["hr-reports"]).toEqual({ anonymous: false });
  });

  test("pins every direct pre-1.0 Portal package exactly", () => {
    expect(packageJson.dependencies["@portalsdk/core"]).toBe("0.1.4");
    expect(packageJson.dependencies["@portalsdk/react"]).toBe("0.1.2");
    expect(packageJson.devDependencies["@portalsdk/config"]).toBe("0.1.4");
    expect(packageJson.devDependencies["@portalsdk/cli"]).toBe("0.4.1");
  });

  test("selects one fork-configurable Vercel region", () => {
    expect(vercelConfig.regions).toEqual(["iad1"]);
  });

  test("schedules the authenticated Office Day seed at midnight UTC", () => {
    expect(vercelConfig.crons).toEqual([
      { path: "/api/cron/office-days", schedule: "0 0 * * *" },
    ]);
  });

  test("exposes explicit setup and Portal verification commands", () => {
    expect(packageJson.scripts["setup:check"]).toBe(
      "bun scripts/setup-check.ts",
    );
    expect(packageJson.scripts["portal:verify"]).toBe(
      "bun scripts/setup-check.ts",
    );
    expect(packageJson.scripts["portal:deploy"]).toBe(
      "bun scripts/portal-deploy.ts",
    );
    expect(packageJson.scripts.build).not.toContain("migrate");
    expect(packageJson.scripts.start).not.toContain("migrate");
  });
});
