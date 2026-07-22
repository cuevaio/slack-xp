import type { ServiceAdapters } from "@/lib/adapters/types";

const MOCK_CHANNELS = [
  { id: "mock-day:general", name: "General", unreadCount: 0 },
  { id: "mock-day:watercooler", name: "Watercooler", unreadCount: 3 },
  { id: "mock-day:tech-support", name: "Technical Support", unreadCount: 1 },
] as const;

const MOCK_NEW_HIRE_USER_IDS: ReadonlySet<string> = new Set([
  "user_mock_new_hire",
  "user_mock_operator",
]);

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
        if (!MOCK_NEW_HIRE_USER_IDS.has(clerkUserId)) {
          return null;
        }

        return {
          clerkUserId,
          jobTitle: "Senior Synergy Installation Specialist",
          onboardingComplete: true,
        };
      },
    },
  };
}
