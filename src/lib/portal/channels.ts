import { isOfficeDay, officeDay } from "@/lib/portal/office-day";

const VERSIONED_CHANNEL_ROLLOUT_DAY = "2026-07-23";
const VERSIONED_CHANNEL_NAMESPACE = "v2";

export const OFFICE_CHANNEL_DEFINITIONS = [
  {
    slug: "general",
    name: "General",
    purpose: "Company-wide conversation",
    mode: "standard",
  },
  {
    slug: "watercooler",
    name: "Watercooler",
    purpose: "Casual conversation and breakroom chatter",
    mode: "standard",
  },
  {
    slug: "tech-support",
    name: "Technical Support",
    purpose: "Comedic technical support for suspicious office technology",
    mode: "standard",
  },
  {
    slug: "urgent",
    name: "Urgent",
    purpose: "Urgent workplace chatter",
    mode: "standard",
  },
  {
    slug: "all-hands",
    name: "All Hands",
    purpose: "System Events and company-wide announcements",
    mode: "broadcast",
  },
] as const;

export type OfficeChannelSlug =
  (typeof OFFICE_CHANNEL_DEFINITIONS)[number]["slug"];

export type OfficeChannelMode =
  (typeof OFFICE_CHANNEL_DEFINITIONS)[number]["mode"];

export type OfficeChannel = {
  slug: OfficeChannelSlug;
  id: string;
  name: string;
  purpose: string;
  mode: OfficeChannelMode;
};

export { officeDay } from "@/lib/portal/office-day";

export function officeDayFromChannelId(value: string): string | null {
  const currentOfficeDay = value.split(":").at(-1);
  return currentOfficeDay && isOfficeDay(currentOfficeDay)
    ? currentOfficeDay
    : null;
}

export function officeDayChannelGeneration(currentOfficeDay: string): 1 | 2 {
  if (!isOfficeDay(currentOfficeDay)) {
    throw new TypeError("A valid UTC Office Day is required.");
  }
  return currentOfficeDay >= VERSIONED_CHANNEL_ROLLOUT_DAY ? 2 : 1;
}

export function officeDayChannelIdsForAccessControl(
  channelNames: readonly string[],
  currentOfficeDay: string,
): string[] {
  const canonical = channelNames.map((channelName) =>
    officeDayChannelId(channelName, currentOfficeDay),
  );
  if (currentOfficeDay !== VERSIONED_CHANNEL_ROLLOUT_DAY) return canonical;
  return [
    ...canonical,
    ...channelNames.map((channelName) => `${channelName}:${currentOfficeDay}`),
  ];
}

export function isOfficeChannelIdForDay(
  value: unknown,
  currentOfficeDay: string,
): value is string {
  return (
    typeof value === "string" &&
    isOfficeDay(currentOfficeDay) &&
    officeDayChannelIdsForAccessControl(
      OFFICE_CHANNEL_DEFINITIONS.map(({ slug }) => slug),
      currentOfficeDay,
    ).includes(value)
  );
}

export function officeDayChannelId(
  channelName: string,
  currentOfficeDay: string,
): string {
  if (
    !/^[a-z][a-z0-9-]*$/u.test(channelName) ||
    !isOfficeDay(currentOfficeDay)
  ) {
    throw new TypeError(
      "A valid channel name and UTC Office Day are required.",
    );
  }
  const namespace =
    officeDayChannelGeneration(currentOfficeDay) === 2
      ? `:${VERSIONED_CHANNEL_NAMESPACE}`
      : "";
  return `${channelName}${namespace}:${currentOfficeDay}`;
}

export function officeChannelId(
  slug: OfficeChannelSlug,
  now: Date = new Date(),
): string {
  return officeDayChannelId(slug, officeDay(now));
}

export function listOfficeChannels(now: Date = new Date()): OfficeChannel[] {
  return listOfficeChannelsForDay(officeDay(now));
}

export function listOfficeChannelsForDay(
  currentOfficeDay: string,
): OfficeChannel[] {
  if (!isOfficeDay(currentOfficeDay)) {
    throw new TypeError("A valid UTC Office Day is required.");
  }
  return OFFICE_CHANNEL_DEFINITIONS.map((channel) => ({
    ...channel,
    id: officeDayChannelId(channel.slug, currentOfficeDay),
  }));
}

export function isOfficeChannelSlug(value: string): value is OfficeChannelSlug {
  return OFFICE_CHANNEL_DEFINITIONS.some(({ slug }) => slug === value);
}
