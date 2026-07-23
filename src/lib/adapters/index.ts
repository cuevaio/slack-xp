import { createLiveAdapters } from "@/lib/adapters/live";
import type { ServiceAdapters } from "@/lib/adapters/types";
import type { ReadyAppConfiguration } from "@/lib/config";

export function createServiceAdapters(
  configuration: ReadyAppConfiguration,
): ServiceAdapters {
  return createLiveAdapters(configuration);
}

export type {
  NeonAdapter,
  PortalAdapter,
  ServiceAdapters,
} from "@/lib/adapters/types";
