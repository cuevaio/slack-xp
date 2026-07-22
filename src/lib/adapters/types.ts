import type { OnboardingRepository } from "@/lib/onboarding/types";
import type { ProfileRepository } from "@/lib/profiles/types";
import type { PortalAuthority } from "@/lib/portal/types";

export type PortalChannel = {
  id: string;
  name: string;
  unreadCount: number;
};

export type PortalAdapter = PortalAuthority & {
  listChannels(): Promise<readonly PortalChannel[]>;
};

export type NeonAdapter = OnboardingRepository & ProfileRepository;

export type ServiceAdapters = {
  kind: "mock" | "live";
  portal: PortalAdapter;
  neon: NeonAdapter;
};
