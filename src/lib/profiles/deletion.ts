import type { EmploymentPortalAuthority } from "@/lib/employment/contract";
import {
  OFFICE_CHANNEL_DEFINITIONS,
  officeDayChannelIds,
} from "@/lib/portal/channels";
import { officeDay } from "@/lib/portal/office-day";
import { flushProfileInvalidations } from "@/lib/profiles/propagation";
import type {
  DeletedClerkProfile,
  ProfileInvalidationPublisher,
  ProfileProjectionResult,
  ProfileRepository,
} from "@/lib/profiles/types";

export type ProfileDeletionPortal = ProfileInvalidationPublisher &
  Pick<EmploymentPortalAuthority, "applyTerminationBans">;

export async function deleteClerkProfile({
  repository,
  portal,
  tombstone,
  now = new Date(),
}: {
  repository: ProfileRepository;
  portal: ProfileDeletionPortal;
  tombstone: DeletedClerkProfile;
  now?: Date;
}): Promise<ProfileProjectionResult> {
  const result = await repository.tombstoneProfile(tombstone);
  // Publish the stable-reference invalidation before the ban disconnects live
  // clients from the Office Event channel.
  await flushProfileInvalidations(repository, portal);

  const [canonical] = await repository.getProfiles([tombstone.clerkUserId]);
  if (canonical?.status === "former") {
    await portal.applyTerminationBans({
      channelIds: officeDayChannelIds(
        [
          ...OFFICE_CHANNEL_DEFINITIONS.map(({ slug }) => slug),
          "office-events",
        ],
        officeDay(now),
      ),
      newHireId: tombstone.clerkUserId,
    });
  }
  return result;
}
