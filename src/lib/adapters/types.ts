export type ClerkUser = {
  id: string;
  fullName: string;
  imageUrl: string | null;
};

export type PortalChannel = {
  id: string;
  name: string;
  unreadCount: number;
};

export type NewHireRecord = {
  clerkUserId: string;
  jobTitle: string;
  onboardingComplete: boolean;
};

export type ClerkAdapter = {
  getCurrentUser(): Promise<ClerkUser | null>;
};

export type PortalAdapter = {
  listChannels(): Promise<readonly PortalChannel[]>;
};

export type NeonAdapter = {
  getNewHire(clerkUserId: string): Promise<NewHireRecord | null>;
};

export type ServiceAdapters = {
  kind: "mock" | "live";
  clerk: ClerkAdapter;
  portal: PortalAdapter;
  neon: NeonAdapter;
};
