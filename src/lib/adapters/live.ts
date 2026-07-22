import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";

// These boundaries intentionally do no network work during construction. Service-specific
// integrations can replace each method without changing the office entry contract.
export function createLiveAdapters(
  _configuration: ReadyAppConfiguration,
): ServiceAdapters {
  return {
    kind: "live",
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
