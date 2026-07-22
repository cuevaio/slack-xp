import type { ServiceAdapters } from "@/lib/adapters/types";

const MOCK_USER = {
  id: "user_mock_new_hire",
  fullName: "Pat Pending",
  imageUrl: null,
} as const;

const MOCK_CHANNELS = [
  { id: "mock-day:general", name: "General", unreadCount: 0 },
  { id: "mock-day:watercooler", name: "Watercooler", unreadCount: 3 },
  { id: "mock-day:tech-support", name: "Technical Support", unreadCount: 1 },
] as const;

export function createMockAdapters(): ServiceAdapters {
  return {
    kind: "mock",
    clerk: {
      async getCurrentUser() {
        return MOCK_USER;
      },
    },
    portal: {
      async listChannels() {
        return MOCK_CHANNELS;
      },
    },
    neon: {
      async getNewHire(clerkUserId) {
        return clerkUserId === MOCK_USER.id
          ? {
              clerkUserId,
              jobTitle: "Senior Synergy Installation Specialist",
              onboardingComplete: true,
            }
          : null;
      },
    },
  };
}
