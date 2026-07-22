import { describe, expect, test } from "bun:test";
import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";

describe("service adapter boundary", () => {
  test("returns deterministic Clerk-, Portal-, and Neon-shaped mock data", async () => {
    const configuration = readAppConfiguration({
      APP_ENV: "test",
      SERVICE_MODE: "mock",
    });
    if (configuration.status !== "ready") {
      throw new Error("Mock test configuration should be ready");
    }

    const adapters = createServiceAdapters(configuration);
    const firstUser = await adapters.clerk.getCurrentUser();
    const secondUser = await adapters.clerk.getCurrentUser();
    const channels = await adapters.portal.listChannels();
    const newHire = firstUser
      ? await adapters.neon.getNewHire(firstUser.id)
      : null;

    expect(firstUser).toEqual(secondUser);
    expect(channels.map((channel) => channel.name)).toEqual([
      "General",
      "Watercooler",
      "Technical Support",
    ]);
    expect(newHire).toMatchObject({ onboardingComplete: true });
  });

  test("keeps adapter construction behind successful validation", () => {
    const configuration = readAppConfiguration({ APP_ENV: "production" });
    expect(configuration.status).toBe("incomplete");

    let adaptersCreated = false;
    if (configuration.status === "ready") {
      createServiceAdapters(configuration);
      adaptersCreated = true;
    }

    expect(adaptersCreated).toBe(false);
  });
});
