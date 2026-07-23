import emojiData from "emojibase-data/en/compact.json";
import shortcodeData from "emojibase-data/en/shortcodes/emojibase.json";

export type EmojiSuggestion = {
  hexcode: string;
  label: string;
  shortcode: string;
  unicode: string;
};

export type EmojiTrigger = {
  start: number;
  end: number;
  query: string;
};

type SearchableEmoji = EmojiSuggestion & {
  aliases: readonly string[];
  searchText: string;
};

const emojiByHexcode = new Map(
  emojiData.map((emoji) => [emoji.hexcode, emoji]),
);
const emojiByShortcode = new Map<string, string>();
const searchableEmojis: SearchableEmoji[] = [];

for (const [hexcode, value] of Object.entries(shortcodeData)) {
  const emoji = emojiByHexcode.get(hexcode);
  if (!emoji) continue;
  const aliases = Array.isArray(value) ? value : [value];
  for (const alias of aliases) emojiByShortcode.set(alias, emoji.unicode);
  searchableEmojis.push({
    aliases,
    hexcode,
    label: emoji.label,
    searchText:
      `${aliases.join(" ")} ${emoji.label} ${(emoji.tags ?? []).join(" ")}`.toLocaleLowerCase(),
    shortcode: aliases.toSorted((left, right) => left.length - right.length)[0],
    unicode: emoji.unicode,
  });
}

const DEFAULT_SHORTCODES = [
  "smile",
  "joy",
  "heart",
  "thumbsup",
  "tada",
  "fire",
  "eyes",
  "thinking",
];

function suggestionFor(emoji: SearchableEmoji, query: string): EmojiSuggestion {
  const shortcode =
    emoji.aliases.find((alias) => alias === query) ??
    emoji.aliases.find((alias) => alias.startsWith(query)) ??
    emoji.shortcode;
  return {
    hexcode: emoji.hexcode,
    label: emoji.label,
    shortcode,
    unicode: emoji.unicode,
  };
}

export function findEmojiTrigger(text: string, cursor: number) {
  const match = text.slice(0, cursor).match(/(^|\s):([+\-\w]{0,40})$/u);
  if (!match) return null;
  const query = match[2];
  return {
    start: cursor - query.length - 1,
    end: cursor,
    query,
  } satisfies EmojiTrigger;
}

export function searchEmojis(query: string, limit = 8) {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) {
    return DEFAULT_SHORTCODES.flatMap((shortcode) => {
      const emoji = searchableEmojis.find(({ aliases }) =>
        aliases.includes(shortcode),
      );
      return emoji ? [suggestionFor(emoji, shortcode)] : [];
    }).slice(0, limit);
  }

  return searchableEmojis
    .flatMap((emoji) => {
      const exact = emoji.aliases.includes(normalizedQuery);
      const shortcodePrefix = emoji.aliases.some((alias) =>
        alias.startsWith(normalizedQuery),
      );
      const labelPrefix = emoji.label
        .toLocaleLowerCase()
        .startsWith(normalizedQuery);
      if (!emoji.searchText.includes(normalizedQuery)) return [];
      return [
        {
          emoji,
          rank: exact ? 0 : shortcodePrefix ? 1 : labelPrefix ? 2 : 3,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        left.rank - right.rank ||
        left.emoji.shortcode.length - right.emoji.shortcode.length,
    )
    .slice(0, limit)
    .map(({ emoji }) => suggestionFor(emoji, normalizedQuery));
}

export function replaceEmojiShortcodes(text: string, cursor = text.length) {
  let nextCursor = cursor;
  const nextText = text.replace(
    /:([+\-\w]+):/gu,
    (shortcode, name: string, offset: number) => {
      const unicode = emojiByShortcode.get(name.toLocaleLowerCase());
      if (!unicode) return shortcode;
      if (offset + shortcode.length <= cursor)
        nextCursor += unicode.length - shortcode.length;
      return unicode;
    },
  );
  return { text: nextText, cursor: nextCursor };
}
