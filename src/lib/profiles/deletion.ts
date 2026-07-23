import type { EmploymentPortalAuthority } from "@/lib/employment/contract";
import { officeEventChannelId } from "@/lib/office-events/contract";
import { listOfficeChannels } from "@/lib/portal/channels";
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
      channelIds: [
        ...listOfficeChannels(now).map(({ id }) => id),
        officeEventChannelId(now),
      ],
      newHireId: tombstone.clerkUserId,
    });
  }
  return result;
}
