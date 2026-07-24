export const OFFICE_CHANNEL_DEFINITIONS = [
  {
    slug: "general",
    name: "General",
    purpose: "Company-wide conversation",
    mode: "standard",
  },
  {
    slug: "announcements-v2",
    name: "Announcements",
    purpose: "Company-wide announcements",
    mode: "standard",
  },
] as const;

export type OfficeChannelSlug =
  (typeof OFFICE_CHANNEL_DEFINITIONS)[number]["slug"];

export type OfficeChannelMode =
  (typeof OFFICE_CHANNEL_DEFINITIONS)[number]["mode"];

export type OfficeChannel = {
  slug: OfficeChannelSlug;
  id: OfficeChannelSlug;
  name: string;
  purpose: string;
  mode: OfficeChannelMode;
};

export function listOfficeChannels(): OfficeChannel[] {
  return OFFICE_CHANNEL_DEFINITIONS.map((channel) => ({
    ...channel,
    id: channel.slug,
  }));
}

export function isOfficeChannelSlug(value: string): value is OfficeChannelSlug {
  return OFFICE_CHANNEL_DEFINITIONS.some(({ slug }) => slug === value);
}
