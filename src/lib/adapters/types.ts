export type PortalChannel = {
  id: string;
  name: string;
  unreadCount: number;
};

import type { OnboardingRepository } from "@/lib/onboarding/types";

export type PortalAdapter = {
  listChannels(): Promise<readonly PortalChannel[]>;
};

export type NeonAdapter = OnboardingRepository;

export type ServiceAdapters = {
  kind: "mock" | "live";
  portal: PortalAdapter;
  neon: NeonAdapter;
};
