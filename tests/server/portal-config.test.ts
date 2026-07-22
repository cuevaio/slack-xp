import { describe, expect, test } from "bun:test";
import packageJson from "../../package.json";
import portalConfig from "../../portal.config";
import vercelConfig from "../../vercel.json";

describe("deployed Portal customer contract", () => {
  test("refuses anonymous access without content middleware", () => {
    expect(portalConfig.channels?.["*"]).toEqual({ anonymous: false });
    expect(portalConfig.channels?.["all-hands:*"]).toEqual({
      anonymous: false,
      mode: "broadcast",
    });
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

  test("exposes explicit setup and Portal verification commands", () => {
    expect(packageJson.scripts["setup:check"]).toBe(
      "bun scripts/setup-check.ts",
    );
    expect(packageJson.scripts["portal:verify"]).toBe(
      "bun scripts/setup-check.ts",
    );
    expect(packageJson.scripts.build).not.toContain("migrate");
    expect(packageJson.scripts.start).not.toContain("migrate");
  });
});
