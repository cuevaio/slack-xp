import { describe, expect, test } from "bun:test";
import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";

describe("service adapter boundary", () => {
  test("returns deterministic Portal- and Neon-shaped mock data", async () => {
    const configuration = readAppConfiguration({
      APP_ENV: "test",
      SERVICE_MODE: "mock",
    });
    if (configuration.status !== "ready") {
      throw new Error("Mock test configuration should be ready");
    }

    const adapters = createServiceAdapters(configuration);
    const channels = await adapters.portal.listChannels();
    const newHire = await adapters.neon.enterNewHire({
      clerkUserId: "user_adapter_test",
      firstName: "Pat",
      lastName: "Pending",
      displayName: "Pat Pending",
      imageUrl: null,
      sourceVersion: 1,
    });

    expect(
      channels.map(({ slug, name, mode }) => ({ slug, name, mode })),
    ).toEqual([
      { slug: "general", name: "General", mode: "standard" },
      { slug: "watercooler", name: "Watercooler", mode: "standard" },
      {
        slug: "tech-support",
        name: "Technical Support",
        mode: "standard",
      },
      { slug: "urgent", name: "Urgent", mode: "standard" },
      { slug: "all-hands", name: "All Hands", mode: "broadcast" },
    ]);
    expect(
      channels.some((channel) => channel.id.startsWith("office-events:")),
    ).toBe(false);
    expect(newHire).toMatchObject({ step: "profile" });
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
