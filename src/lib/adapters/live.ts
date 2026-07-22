import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { createDatabase } from "@/lib/db/client";
import { createNeonOnboardingRepository } from "@/lib/onboarding/neon";
import { generalChannelId } from "@/lib/portal/chat";
import { createPortalControlPlane } from "@/lib/portal/server";

// These boundaries intentionally do no network work during construction. Service-specific
// integrations can replace each method without changing the office entry contract.
export function createLiveAdapters(
  configuration: ReadyAppConfiguration,
): ServiceAdapters {
  const databaseUrl = configuration.values.DATABASE_URL;
  const portalSecret = configuration.values.PORTAL_SECRET;
  if (!databaseUrl || !portalSecret) {
    throw new Error("Validated live configuration is missing a server value.");
  }
  const portalControlPlane = createPortalControlPlane({ secret: portalSecret });

  return {
    kind: "live",
    portal: {
      ...portalControlPlane,
      async listChannels() {
        return [{ id: generalChannelId(), name: "General", unreadCount: 0 }];
      },
    },
    neon: createNeonOnboardingRepository(createDatabase(databaseUrl)),
  };
}
