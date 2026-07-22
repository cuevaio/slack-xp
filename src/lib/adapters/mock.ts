import type { ServiceAdapters } from "@/lib/adapters/types";
import { createInMemoryOnboardingRepository } from "@/lib/onboarding/memory";
import type { NewHireProfile } from "@/lib/onboarding/types";

const MOCK_CHANNELS = [
  { id: "mock-day:general", name: "General", unreadCount: 0 },
  { id: "mock-day:watercooler", name: "Watercooler", unreadCount: 3 },
  { id: "mock-day:tech-support", name: "Technical Support", unreadCount: 1 },
] as const;

const MOCK_REPOSITORY_KEY = Symbol.for(
  "portal-messenger.mock-onboarding-repository",
);

type MockGlobal = typeof globalThis & {
  [MOCK_REPOSITORY_KEY]?: ReturnType<typeof createInMemoryOnboardingRepository>;
};

function getMockRepository() {
  const mockGlobal = globalThis as MockGlobal;
  mockGlobal[MOCK_REPOSITORY_KEY] ??= createInMemoryOnboardingRepository();
  return mockGlobal[MOCK_REPOSITORY_KEY];
}

export function resetMockOnboarding(): void {
  getMockRepository().reset();
}

export async function seedCompletedMockOnboarding(
  profile: NewHireProfile,
): Promise<void> {
  const repository = getMockRepository();
  await repository.enterNewHire(profile);
  await repository.confirmProfile(profile);
  await repository.acceptConduct(profile.clerkUserId);
  await repository.clockIn(profile.clerkUserId);
}

export function createMockAdapters(): ServiceAdapters {
  const neon = getMockRepository();
  return {
    kind: "mock",
    portal: {
      async listChannels() {
        return MOCK_CHANNELS;
      },
    },
    neon,
  };
}
