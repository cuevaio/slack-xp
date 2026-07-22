import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { createDatabase } from "@/lib/db/client";
import { createNeonRepository } from "@/lib/onboarding/neon";
import { listOfficeChannels } from "@/lib/portal/channels";
import {
  createPortalControlPlane,
  createPortalProfileInvalidationPublisher,
} from "@/lib/portal/server";

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
  const profileInvalidationPublisher = createPortalProfileInvalidationPublisher(
    {
      secret: portalSecret,
      apiKey: configuration.values.NEXT_PUBLIC_PORTAL_KEY,
    },
  );

  return {
    kind: "live",
    portal: {
      ...portalControlPlane,
      ...profileInvalidationPublisher,
      async listChannels() {
        return listOfficeChannels();
      },
    },
    neon: createNeonRepository(createDatabase(databaseUrl)),
  };
}
