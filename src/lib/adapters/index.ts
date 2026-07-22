import { createLiveAdapters } from "@/lib/adapters/live";
import { createMockAdapters } from "@/lib/adapters/mock";
import type { ServiceAdapters } from "@/lib/adapters/types";
import type { AppConfiguration } from "@/lib/config";

type ReadyConfiguration = Extract<AppConfiguration, { status: "ready" }>;

export function createServiceAdapters(
  configuration: ReadyConfiguration,
): ServiceAdapters {
  return configuration.serviceMode === "mock"
    ? createMockAdapters()
    : createLiveAdapters(configuration);
}

export type {
  NeonAdapter,
  PortalAdapter,
  ServiceAdapters,
} from "@/lib/adapters/types";
