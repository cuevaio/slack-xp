import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { createDatabase } from "@/lib/db/client";
import { createNeonRepository } from "@/lib/onboarding/neon";
import { listOfficeChannels } from "@/lib/portal/channels";
import {
  createPortalControlPlane,
  createPortalHRReportNotificationPublisher,
  createPortalProfileInvalidationPublisher,
  createPortalScriptedSystemEventPublisher,
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
  const scriptedSystemEventPublisher = createPortalScriptedSystemEventPublisher(
    {
      secret: portalSecret,
      apiKey: configuration.values.NEXT_PUBLIC_PORTAL_KEY,
    },
  );
  const hrReportNotificationPublisher =
    createPortalHRReportNotificationPublisher({
      secret: portalSecret,
      apiKey: configuration.values.NEXT_PUBLIC_PORTAL_KEY,
    });

  return {
    kind: "live",
    portal: {
      ...portalControlPlane,
      ...profileInvalidationPublisher,
      ...scriptedSystemEventPublisher,
      ...hrReportNotificationPublisher,
      async listChannels(now) {
        return listOfficeChannels(now);
      },
    },
    neon: createNeonRepository(createDatabase(databaseUrl)),
  };
}
