import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { createDatabase } from "@/lib/db/client";
import { createNeonRepository } from "@/lib/onboarding/neon";

// These boundaries intentionally do no network work during construction. Service-specific
// integrations can replace each method without changing the office entry contract.
export function createLiveAdapters(
  configuration: ReadyAppConfiguration,
): ServiceAdapters {
  const databaseUrl = configuration.values.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Validated live configuration is missing DATABASE_URL.");
  }

  return {
    kind: "live",
    portal: {
      async listChannels() {
        return [];
      },
    },
    neon: createNeonRepository(createDatabase(databaseUrl)),
  };
}
