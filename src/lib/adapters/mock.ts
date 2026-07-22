import type { ServiceAdapters } from "@/lib/adapters/types";

const MOCK_CHANNELS = [
  { id: "mock-day:general", name: "General", unreadCount: 0 },
  { id: "mock-day:watercooler", name: "Watercooler", unreadCount: 3 },
  { id: "mock-day:tech-support", name: "Technical Support", unreadCount: 1 },
] as const;

export function createMockAdapters(): ServiceAdapters {
  return {
    kind: "mock",
    portal: {
      async listChannels() {
        return MOCK_CHANNELS;
      },
    },
    neon: {
      async getNewHire(clerkUserId) {
        return clerkUserId === "user_mock_new_hire" ||
          clerkUserId === "user_mock_operator"
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
