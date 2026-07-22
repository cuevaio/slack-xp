import { isOfficeDay, officeDay } from "@/lib/portal/office-day";

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

export function officeChannelId(
  slug: OfficeChannelSlug,
  now: Date = new Date(),
): string {
  return `${slug}:${officeDay(now)}`;
}

export function listOfficeChannels(now: Date = new Date()): OfficeChannel[] {
  return OFFICE_CHANNEL_DEFINITIONS.map((channel) => ({
    ...channel,
    id: officeChannelId(channel.slug, now),
  }));
}

export function listOfficeChannelsForDay(
  currentOfficeDay: string,
): OfficeChannel[] {
  if (!isOfficeDay(currentOfficeDay)) {
    throw new TypeError("A valid UTC Office Day is required.");
  }
  return listOfficeChannels(new Date(`${currentOfficeDay}T00:00:00.000Z`));
}

export function isOfficeChannelSlug(value: string): value is OfficeChannelSlug {
  return OFFICE_CHANNEL_DEFINITIONS.some(({ slug }) => slug === value);
}
