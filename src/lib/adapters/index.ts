import { createLiveAdapters } from "@/lib/adapters/live";
import { createMockAdapters } from "@/lib/adapters/mock";
import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";

export function createServiceAdapters(
  configuration: ReadyAppConfiguration,
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
