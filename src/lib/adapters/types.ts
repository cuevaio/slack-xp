import type { OnboardingRepository } from "@/lib/onboarding/types";
import type { OfficeChannel } from "@/lib/portal/channels";
import type { PortalAuthority } from "@/lib/portal/types";
import type { ProfileRepository } from "@/lib/profiles/types";

export type PortalChannel = OfficeChannel;

export type PortalAdapter = PortalAuthority & {
  listChannels(): Promise<readonly PortalChannel[]>;
};

export type NeonAdapter = OnboardingRepository & ProfileRepository;

export type ServiceAdapters = {
  kind: "mock" | "live";
  portal: PortalAdapter;
  neon: NeonAdapter;
};
