import { describe, expect, test } from "bun:test";
import packageJson from "../../package.json";
import portalConfig, {
  containsBlockedLanguage,
  moderateChatMessage,
} from "../../portal.config";
import vercelConfig from "../../vercel.json";

describe("deployed Portal customer contract", () => {
  test("keeps every browser-connected Portal channel authenticated", () => {
    for (const channel of [
      "general:*",
      "watercooler:*",
      "tech-support:*",
      "urgent:*",
    ]) {
      expect(portalConfig.channels?.[channel]).toEqual({ anonymous: false });
    }
    expect(portalConfig.channels?.["all-hands:*"]).toEqual({
      anonymous: false,
      mode: "broadcast",
    });
    expect(portalConfig.channels?.["office-events:*"]).toEqual({
      anonymous: false,
    });
    expect(portalConfig.channels?.["hr-reports"]).toEqual({ anonymous: false });
  });

  test("does not attach hosted hooks while retaining moderation rules", () => {
    for (const channel of [
      "general:*",
      "watercooler:*",
      "tech-support:*",
      "urgent:*",
      "all-hands:*",
    ]) {
      expect(portalConfig.channels?.[channel]?.authz).toBeUndefined();
      expect(portalConfig.channels?.[channel]?.onPublish).toBeUndefined();
    }
    expect(moderateChatMessage).toBeDefined();
  });

  test("blocks whole-word profanity and basic evasions", () => {
    expect(containsBlockedLanguage("what the FUCK")).toBe(true);
    expect(containsBlockedLanguage("this is sh1t")).toBe(true);
    expect(containsBlockedLanguage("f.u.c.k that")).toBe(true);
    expect(containsBlockedLanguage("please assist the class")).toBe(false);
    expect(containsBlockedLanguage("a classic bass line")).toBe(false);
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
