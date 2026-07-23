import {
  type OfficeChannelSlug,
  officeChannelId,
  officeDayChannelGeneration,
} from "@/lib/portal/channels";
import { isOfficeDay } from "@/lib/portal/office-day";

export const SCRIPTED_SYSTEM_EVENT_VERSION = 1 as const;
export const SCRIPTED_SYSTEM_EVENT_MESSAGE_TYPE = "system.event" as const;

export const OFFICE_CHARACTERS = [
  {
    id: "office-character:barb-dwyer",
    name: "Barb Dwyer",
    role: "Facilities Liaison",
    fictional: true,
  },
  {
    id: "office-character:chip-ramsey",
    name: "Chip Ramsey",
    role: "Systems Custodian",
    fictional: true,
  },
  {
    id: "office-character:dot-matrix",
    name: "Dot Matrix",
    role: "Document Circulation",
    fictional: true,
  },
] as const;

export type OfficeCharacter = (typeof OFFICE_CHARACTERS)[number];
export type OfficeCharacterId = OfficeCharacter["id"];

type ScriptDefinition = {
  id: string;
  channelSlug: OfficeChannelSlug;
  characterId: OfficeCharacterId;
  text: string;
};

const SCRIPT_DEFINITIONS = [
  {
    id: "general-morning-memo",
    channelSlug: "general",
    characterId: "office-character:barb-dwyer",
    text: "Good morning. The motivational poster has been rebooted and is displaying moderate confidence.",
  },
  {
    id: "watercooler-coffee-audit",
    channelSlug: "watercooler",
    characterId: "office-character:dot-matrix",
    text: "Breakroom notice: the decaf pot is now part of an evidence-preservation process.",
  },
  {
    id: "tech-support-mouse-ball",
    channelSlug: "tech-support",
    characterId: "office-character:chip-ramsey",
    text: "Technical advisory: turning the mouse upside down does not improve wireless reception.",
  },
  {
    id: "urgent-printer-council",
    channelSlug: "urgent",
    characterId: "office-character:barb-dwyer",
    text: "Urgent facilities update: Printer Three has requested representation at the toner council.",
  },
  {
    id: "all-hands-synergy",
    channelSlug: "all-hands",
    characterId: "office-character:chip-ramsey",
    text: "All-hands directive: please save your synergy before the scheduled optimism restart.",
  },
] as const satisfies readonly ScriptDefinition[];

const SCRIPTED_SYSTEM_EVENT_CONTENT_KEYS = [
  "version",
  "type",
  "eventKey",
  "officeDay",
  "scriptId",
  "text",
] as const;

export type ScriptedSystemEvent = {
  version: typeof SCRIPTED_SYSTEM_EVENT_VERSION;
  type: "system.scripted";
  eventKey: string;
  officeDay: string;
  scriptId: string;
  text: string;
};

export type PlannedSystemEvent = {
  eventKey: string;
  officeDay: string;
  scriptId: string;
  channelId: string;
  characterId: OfficeCharacterId;
  dueAt: Date;
  event: ScriptedSystemEvent;
};

export type SafeScriptedSystemEventMessage = {
  id: string;
  channelId: string;
  senderId: OfficeCharacterId;
  timestamp: number;
  eventKey: string;
  character: OfficeCharacter;
  content: ScriptedSystemEvent;
  status: "sent";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function officeCharacterById(id: string): OfficeCharacter | undefined {
  return OFFICE_CHARACTERS.find((character) => character.id === id);
}

export function createScriptedSystemEventKey(
  currentOfficeDay: string,
  scriptId: string,
): string {
  if (!isOfficeDay(currentOfficeDay) || !/^[a-z0-9-]{1,80}$/u.test(scriptId)) {
    throw new TypeError("A valid Office Day and fixed script ID are required.");
  }
  return `system-event:v${SCRIPTED_SYSTEM_EVENT_VERSION}:${currentOfficeDay}:${scriptId}`;
}

export function planOfficeDay(currentOfficeDay: string): PlannedSystemEvent[] {
  if (!isOfficeDay(currentOfficeDay)) {
    throw new TypeError("A valid UTC Office Day is required.");
  }
  const dueAt = new Date(`${currentOfficeDay}T00:00:00.000Z`);
  return SCRIPT_DEFINITIONS.map((script) => {
    const scriptId =
      officeDayChannelGeneration(currentOfficeDay) === 2
        ? `v2-${script.id}`
        : script.id;
    const eventKey = createScriptedSystemEventKey(currentOfficeDay, scriptId);
    return {
      eventKey,
      officeDay: currentOfficeDay,
      scriptId,
      channelId: officeChannelId(script.channelSlug, dueAt),
      characterId: script.characterId,
      dueAt: new Date(dueAt),
      event: {
        version: SCRIPTED_SYSTEM_EVENT_VERSION,
        type: "system.scripted",
        eventKey,
        officeDay: currentOfficeDay,
        scriptId,
        text: script.text,
      },
    };
  });
}

function plannedEventForContent(
  content: Record<string, unknown>,
): PlannedSystemEvent | undefined {
  if (
    !hasExactKeys(content, SCRIPTED_SYSTEM_EVENT_CONTENT_KEYS) ||
    content.version !== SCRIPTED_SYSTEM_EVENT_VERSION ||
    content.type !== "system.scripted" ||
    typeof content.officeDay !== "string" ||
    !isOfficeDay(content.officeDay) ||
    typeof content.eventKey !== "string" ||
    typeof content.scriptId !== "string" ||
    typeof content.text !== "string"
  ) {
    return undefined;
  }
  return planOfficeDay(content.officeDay).find(
    (planned) =>
      planned.eventKey === content.eventKey &&
      planned.scriptId === content.scriptId &&
      planned.event.text === content.text,
  );
}

export function resolveScriptedSystemEventPublication(
  candidate: Pick<
    PlannedSystemEvent,
    "officeDay" | "eventKey" | "channelId" | "characterId" | "event"
  >,
): { planned: PlannedSystemEvent; character: OfficeCharacter } | null {
  const character = officeCharacterById(candidate.characterId);
  const planned = planOfficeDay(candidate.officeDay).find(
    ({ eventKey }) => eventKey === candidate.eventKey,
  );
  if (
    !character ||
    !planned ||
    planned.channelId !== candidate.channelId ||
    planned.characterId !== candidate.characterId ||
    planned.event.text !== candidate.event.text
  ) {
    return null;
  }

  return { planned, character };
}

export function parseScriptedSystemEventMessage(
  value: unknown,
  expectedChannelId: string,
): SafeScriptedSystemEventMessage | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.channelId !== expectedChannelId ||
    !isObject(value.sender) ||
    typeof value.sender.id !== "string" ||
    value.sender.anon !== false ||
    typeof value.timestamp !== "number" ||
    !Number.isSafeInteger(value.timestamp) ||
    value.timestamp < 0 ||
    value.retracted !== false ||
    value.ephemeral !== false ||
    value.kind !== "text" ||
    value.type !== SCRIPTED_SYSTEM_EVENT_MESSAGE_TYPE ||
    value.status !== "sent" ||
    !isObject(value.content)
  ) {
    return null;
  }
  const planned = plannedEventForContent(value.content);
  const character = officeCharacterById(value.sender.id);
  if (
    !planned ||
    !character ||
    planned.channelId !== expectedChannelId ||
    planned.characterId !== character.id
  ) {
    return null;
  }
  return {
    id: value.id,
    channelId: planned.channelId,
    senderId: planned.characterId,
    timestamp: value.timestamp,
    eventKey: planned.eventKey,
    character,
    content: planned.event,
    status: "sent",
  };
}
