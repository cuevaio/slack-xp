import { Portal } from "@portalsdk/core";
import {
  createMigrationPublishBody,
  type MigrationHistoryMessage,
  type MigrationMemberRow,
  planAnnouncementMigration,
  preflightAnnouncementMigration,
  resolveAnnouncementMembers,
} from "../src/lib/portal/announcement-migration";
import { REACTION_EVENT_TYPE } from "../src/lib/portal/reactions";

const API_URL = "https://api.useportal.co";
const REALTIME_URL = "https://realtime.useportal.co";
const SOURCE_CHANNEL_ID = "announcements";
const TARGET_CHANNEL_ID = "announcements-v2";
const IDENTITY_CHANNEL_ID = "general";
const MIGRATION_USER_ID = "portal-announcements-migration";

const secret = process.env.PORTAL_SECRET;
if (!secret) throw new Error("PORTAL_SECRET is required.");
const portalSecret = secret;

async function request<T>(
  baseUrl: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Portal ${response.status} for ${path}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function mintToken(channelIds: readonly string[]) {
  const payload = await request<{ token: string }>(
    API_URL,
    "/v1/tokens",
    portalSecret,
    {
      method: "POST",
      body: JSON.stringify({
        userId: MIGRATION_USER_ID,
        claims: { username: "Migration utility" },
        channels: Object.fromEntries(
          channelIds.map((channelId) => [channelId, ["connect"]]),
        ),
        ttl: "30m",
      }),
    },
  );
  return payload.token;
}

async function readHistory(channelId: string, token: string) {
  const pages: MigrationHistoryMessage[][] = [];
  let before: number | undefined;

  for (;;) {
    const query = new URLSearchParams({ limit: "100" });
    if (before !== undefined) query.set("before", String(before));
    const page = await request<{
      msgs: MigrationHistoryMessage[];
      hasMore: boolean;
    }>(REALTIME_URL, `/v1/channels/${channelId}/history?${query}`, token);
    pages.push(page.msgs);
    if (!page.hasMore || page.msgs.length === 0) break;
    before = Math.min(...page.msgs.map(({ seq }) => seq));
  }

  return pages.flat().toSorted((left, right) => left.seq - right.seq);
}

async function readMembers(channelId: string, token: string) {
  const members: MigrationMemberRow[] = [];
  let cursor: string | undefined;

  for (;;) {
    const query = new URLSearchParams();
    if (cursor) query.set("cursor", cursor);
    const suffix = query.size > 0 ? `?${query}` : "";
    const page = await request<{
      members: MigrationMemberRow[];
      cursor?: string;
    }>(REALTIME_URL, `/v1/channels/${channelId}/members${suffix}`, token);
    members.push(...page.members);
    if (!page.cursor) break;
    cursor = page.cursor;
  }

  return members;
}

async function addMember(
  channelId: string,
  userId: string,
  claims: Record<string, unknown>,
) {
  await request(API_URL, `/v1/channels/${channelId}/members`, portalSecret, {
    method: "POST",
    body: JSON.stringify({ userId, claims }),
  });
}

async function removeMember(channelId: string, userId: string) {
  await request(
    API_URL,
    `/v1/channels/${channelId}/members/${userId}`,
    portalSecret,
    { method: "DELETE" },
  );
}

async function assertStandardChannel(token: string) {
  const publicKey = process.env.NEXT_PUBLIC_PORTAL_KEY;
  if (!publicKey)
    throw new Error("NEXT_PUBLIC_PORTAL_KEY is required with --apply.");
  const portal = new Portal({ apiKey: publicKey, token });
  const channel = portal.channel(TARGET_CHANNEL_ID, { history: "none" });
  channel.acquire();
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Target channel did not become ready.")),
        10_000,
      );
      const unsubscribe = channel.subscribe(() => {
        if (channel.status !== "ready") return;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });
    });
    if (channel.info?.mode !== "standard") {
      throw new Error(
        `${TARGET_CHANNEL_ID} already exists as ${channel.info?.mode ?? "unknown"}; aborting.`,
      );
    }
  } finally {
    channel.release();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sourceToken = await mintToken([SOURCE_CHANNEL_ID, IDENTITY_CHANNEL_ID]);
  const sourceMessages = await readHistory(SOURCE_CHANNEL_ID, sourceToken);
  const identityMembers = await readMembers(IDENTITY_CHANNEL_ID, sourceToken);
  const activeMessages = sourceMessages.filter(({ retracted }) => !retracted);
  const preflight = preflightAnnouncementMigration(sourceMessages);
  const migratableIds = new Set(preflight.migratableIds);
  const memberResolution = resolveAnnouncementMembers(
    activeMessages.filter(({ id }) => migratableIds.has(id)),
    identityMembers,
  );
  const summary = {
    source: SOURCE_CHANNEL_ID,
    target: TARGET_CHANNEL_ID,
    total: sourceMessages.length,
    active: activeMessages.length,
    retracted: sourceMessages.length - activeMessages.length,
    reactions: activeMessages.filter(({ type }) => type === REACTION_EVENT_TYPE)
      .length,
    orphanReactions: preflight.orphanReactionIds.length,
    migratable: preflight.migratableIds.length,
    resolvedMembers: memberResolution.members.length,
    unresolvedUserIds: memberResolution.unresolvedUserIds,
    blockers: preflight.blockers,
  };

  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", ...summary }, null, 2));
    if (preflight.blockers.length === 0) {
      console.log("Run again with --apply after deploying portal.config.ts.");
    } else {
      process.exitCode = 1;
    }
    return;
  }
  if (preflight.blockers.length > 0) {
    throw new Error(
      `Migration preflight failed before target mutation:\n${preflight.blockers.join("\n")}`,
    );
  }

  await addMember(TARGET_CHANNEL_ID, MIGRATION_USER_ID, {
    username: "Migration utility",
  });
  try {
    const targetToken = await mintToken([TARGET_CHANNEL_ID]);
    await assertStandardChannel(targetToken);
    const targetMessages = await readHistory(TARGET_CHANNEL_ID, targetToken);
    const plan = planAnnouncementMigration(sourceMessages, targetMessages);
    const messageIds = plan.messageIds;

    let migrated = 0;
    for (const message of plan.pending) {
      const body = createMigrationPublishBody(message, messageIds);
      const result = await request<{ id: string }>(
        API_URL,
        `/v1/channels/${TARGET_CHANNEL_ID}/messages`,
        portalSecret,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      messageIds.set(message.id, result.id);
      migrated++;
    }

    await Promise.all(
      memberResolution.members.map(({ userId, claims }) =>
        addMember(TARGET_CHANNEL_ID, userId, claims),
      ),
    );
    console.log(
      JSON.stringify(
        {
          mode: "apply",
          ...summary,
          migrated,
          skipped: plan.skipped,
          members: memberResolution.members.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await removeMember(TARGET_CHANNEL_ID, MIGRATION_USER_ID);
  }
}

await main();
