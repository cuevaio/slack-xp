import type { ServiceAdapters } from "@/lib/adapters/types";
import type { AppConfiguration } from "@/lib/config";

type ReadyConfiguration = Extract<AppConfiguration, { status: "ready" }>;

// These boundaries intentionally do no network work during construction. Service-specific
// integrations can replace each method without changing the office entry contract.
export function createLiveAdapters(
  _configuration: ReadyConfiguration,
): ServiceAdapters {
  return {
    kind: "live",
    clerk: {
      async getCurrentUser() {
        return null;
      },
    },
    portal: {
      async listChannels() {
        return [];
      },
    },
    neon: {
      async getNewHire() {
        return null;
      },
    },
  };
}
