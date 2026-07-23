import {
  allow,
  defineConfig,
  defineMiddleware,
  retract,
} from "@portalsdk/config";

type ChatMessage = {
  text: string;
};

const BLOCKED_TERMS = new Set([
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "dick",
  "faggot",
  "fuck",
  "motherfucker",
  "nigger",
  "retard",
  "shit",
  "slut",
  "whore",
]);

function moderationTokens(text: string): string[] {
  const normalized = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replaceAll("@", "a")
    .replaceAll("$", "s")
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t")
    .replace(/(\p{L})[._*-]+(?=\p{L})/gu, "$1");

  return normalized.match(/\p{L}+/gu) ?? [];
}

export function containsBlockedLanguage(text: string): boolean {
  return moderationTokens(text).some((token) => BLOCKED_TERMS.has(token));
}

export const moderateChatMessage = defineMiddleware<ChatMessage>(
  "publish",
  (ctx) => {
    ctx.defer(async () => {
      const text = ctx.message.content?.text;
      if (typeof text === "string" && containsBlockedLanguage(text)) {
        return retract(
          "That message contains language that is not allowed in the Shared Public Office.",
        );
      }
    });
    return allow();
  },
);

const publicOfficeChannel = {
  anonymous: false,
  onPublish: [moderateChatMessage],
};

export default defineConfig({
  channels: {
    "general:*": publicOfficeChannel,
    "watercooler:*": publicOfficeChannel,
    "tech-support:*": publicOfficeChannel,
    "urgent:*": publicOfficeChannel,
    "all-hands:*": { ...publicOfficeChannel, mode: "broadcast" },
    "office-events:*": { anonymous: false },
    "hr-reports": { anonymous: false },
  },
});
