import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/nextjs/server";
import { type ChannelHandle, type Message, Portal } from "@portalsdk/core";
import { parseScriptedSystemEventMessage } from "@/lib/office-days/contract";
import {
  createOfficeEventKey,
  createReactionOfficeEvent,
  OFFICE_EVENT_MESSAGE_TYPE,
  parseOfficeEventMessage,
} from "@/lib/office-events/contract";
import type {
  SmokeCleanupResidual,
  SmokeConfiguration,
  SmokeScenarioAdapter,
  SmokeScenarioId,
  SmokeScenarioResult,
} from "@/lib/smoke/contract";

const PORTAL_API_URL = "https://api.useportal.co";
const UNREGISTERED_ORIGIN = "https://portal-messenger-smoke.invalid";
const WAIT_INTERVAL_MS = 100;
const WAIT_TIMEOUT_MS = 20_000;
const WEBHOOK_WAIT_TIMEOUT_MS = 60_000;

type ChatContent = { text: string };
type JsonObject = Record<string, unknown>;
type ActorRole = "new-hire-a" | "new-hire-b" | "operator";
type ClerkClient = ReturnType<typeof createClerkClient>;
type PortalResource = { release(): void };

type PortalSessionPayload = {
  token: string;
  channelIds: string[];
  eventChannelId: string;
};

type SmokeActor = {
  role: ActorRole | "disposable";
  userId: string;
  clerkSessionId: string;
  clerkToken: string;
  portalSession: PortalSessionPayload | null;
  portal: Portal | null;
};

function assertSmoke(condition: unknown): asserts condition {
  if (!condition) throw new Error("smoke_assertion_failed");
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(WAIT_INTERVAL_MS);
  }
  throw new Error("smoke_wait_timeout");
}

async function connectChannel<M>(
  portal: Portal,
  channelId: string,
): Promise<ChannelHandle<M>> {
  const channel = portal.channel<M>(channelId);
  channel.acquire();
  await waitFor(
    () => channel.status === "ready" || channel.status === "blocked",
  );
  assertSmoke(channel.status === "ready");
  return channel;
}

async function expectBlockedChannel<M>(
  portal: Portal,
  channelId: string,
): Promise<ChannelHandle<M>> {
  const channel = portal.channel<M>(channelId);
  channel.acquire();
  await waitFor(
    () => channel.status === "blocked" || channel.status === "reconnecting",
  );
  assertSmoke(channel.status !== "ready");
  return channel;
}

async function loadUntil(
  channel: ChannelHandle<unknown>,
  predicate: () => boolean,
): Promise<void> {
  for (let page = 0; page < 20 && !predicate(); page += 1) {
    if (!channel.hasPrevious) break;
    await channel.loadPrevious();
  }
  assertSmoke(predicate());
}

function messageById<M>(
  channel: ChannelHandle<M>,
  messageId: string,
): Message<M> | undefined {
  return channel.messages.find((message) => message.id === messageId);
}

function nextUtcOfficeDayBoundary(currentOfficeDay: string): string {
  return new Date(
    Date.parse(`${currentOfficeDay}T00:00:00.000Z`) + 86_400_000,
  ).toISOString();
}

function uniqueSourceId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export class LiveRealServiceSmokeAdapter implements SmokeScenarioAdapter {
  private configuration: SmokeConfiguration | null = null;
  private clerk: ClerkClient | null = null;
  private readonly actors = new Map<ActorRole, SmokeActor>();
  private readonly createdSessions = new Set<string>();
  private readonly disposableActors: SmokeActor[] = [];
  private readonly disposableUserIds = new Set<string>();
  private readonly deletedDisposableIds = new Set<string>();
  private readonly channels = new Set<PortalResource>();
  private readonly inboxUnsubscribes: Array<() => void> = [];
  private newHireAChannel: ChannelHandle<ChatContent> | null = null;
  private newHireBChannel: ChannelHandle<ChatContent> | null = null;
  private operatorChannel: ChannelHandle<ChatContent> | null = null;
  private newHireAEventChannel: ChannelHandle<unknown> | null = null;
  private newHireBEventChannel: ChannelHandle<unknown> | null = null;
  private officeDay = "";
  private generalChannelId = "";
  private eventChannelId = "";
  private persistentMessageId = "";
  private reportMessageId = "";
  private profileReportId: string | null = null;
  private messageReportId: string | null = null;
  private terminationActive = false;
  private originalProfile: { firstName: string; lastName: string } | null =
    null;
  private profileChanged = false;

  async run(
    scenario: SmokeScenarioId,
    configuration: SmokeConfiguration,
  ): Promise<SmokeScenarioResult> {
    this.configuration ??= configuration;
    this.clerk ??= createClerkClient({
      secretKey: configuration.clerkSecretKey,
    });

    switch (scenario) {
      case "security-policy":
        await this.verifySecurityPolicy();
        break;
      case "authenticated-identities":
        await this.verifyAuthenticatedIdentities();
        break;
      case "office-day-outbox":
        await this.verifyOfficeDayOutbox();
        break;
      case "persistent-delivery":
        await this.verifyPersistentDelivery();
        break;
      case "presence-typing-unread":
        await this.verifyPresenceTypingUnread();
        break;
      case "reaction-replay":
        await this.verifyReactionReplay();
        break;
      case "reserved-sender-refusal":
        await this.verifyReservedSenderRefusal();
        break;
      case "profile-invalidation":
        await this.verifyProfileInvalidation();
        break;
      case "hr-reports-inbox":
        await this.verifyHRReportsAndInbox();
        break;
      case "removed-message":
        await this.verifyRemovedMessage();
        break;
      case "termination-lifecycle":
        await this.verifyTerminationLifecycle();
        break;
      case "disposable-lifecycle":
        if (!configuration.runDisposableClerkLifecycle) return "skipped";
        await this.verifyDisposableLifecycle();
        break;
    }
    return "passed";
  }

  async cleanup(): Promise<SmokeCleanupResidual[]> {
    const residuals = new Set<SmokeCleanupResidual>();

    await this.restoreActiveTermination(residuals);
    await this.restoreClerkProfile(residuals);
    await this.dismissOpenHRReports(residuals);
    await this.revokeClerkSessions(residuals);
    await this.deleteDisposableClerkAccounts(residuals);
    this.releasePortalResources();

    return [...residuals];
  }

  private async restoreActiveTermination(
    residuals: Set<SmokeCleanupResidual>,
  ): Promise<void> {
    if (!this.terminationActive) return;

    try {
      const operator = this.actor("operator");
      const target = this.actor("new-hire-b");
      const state = await this.appRequest(
        operator,
        `/api/office/operator/termination?targetNewHireId=${encodeURIComponent(target.userId)}`,
      );
      assertSmoke(state.status === 200 && isObject(state.body));
      if (state.body.activeTermination !== null) {
        const response = await this.appRequest(
          operator,
          "/api/office/operator/termination",
          {
            method: "PATCH",
            body: JSON.stringify({
              requestId: uniqueSourceId("cleanup-reinstate"),
              targetNewHireId: target.userId,
              privateReason: uniqueSourceId("cleanup-private"),
            }),
          },
        );
        assertSmoke(response.status === 200);
      }
      this.terminationActive = false;
    } catch {
      residuals.add("active-termination");
    }
  }

  private async restoreClerkProfile(
    residuals: Set<SmokeCleanupResidual>,
  ): Promise<void> {
    if (!this.profileChanged || !this.originalProfile || !this.clerk) return;

    try {
      const actor = this.actor("new-hire-a");
      await this.clerk.users.updateUser(actor.userId, this.originalProfile);
      await this.appRequest(actor, "/api/office/session");
      this.profileChanged = false;
    } catch {
      residuals.add("clerk-profile-restore");
    }
  }

  private async dismissOpenHRReports(
    residuals: Set<SmokeCleanupResidual>,
  ): Promise<void> {
    for (const reportId of [this.profileReportId, this.messageReportId]) {
      if (!reportId) continue;

      try {
        const response = await this.appRequest(
          this.actor("operator"),
          "/api/office/operator/hr-reports",
          {
            method: "PATCH",
            body: JSON.stringify({ reportId, privateNote: null }),
          },
        );
        assertSmoke(response.status === 200);
      } catch {
        residuals.add("open-hr-report");
      }
    }
  }

  private async revokeClerkSessions(
    residuals: Set<SmokeCleanupResidual>,
  ): Promise<void> {
    if (!this.clerk) return;

    for (const sessionId of this.createdSessions) {
      const belongsToDeletedDisposableActor = this.disposableActors.some(
        (actor) =>
          actor.clerkSessionId === sessionId &&
          this.deletedDisposableIds.has(actor.userId),
      );
      if (belongsToDeletedDisposableActor) continue;

      try {
        await this.clerk.sessions.revokeSession(sessionId);
      } catch {
        residuals.add("clerk-session-revocation");
      }
    }
  }

  private async deleteDisposableClerkAccounts(
    residuals: Set<SmokeCleanupResidual>,
  ): Promise<void> {
    if (!this.clerk) return;

    for (const userId of this.disposableUserIds) {
      if (this.deletedDisposableIds.has(userId)) continue;

      try {
        await this.clerk.users.deleteUser(userId);
        this.deletedDisposableIds.add(userId);
      } catch {
        residuals.add("disposable-clerk-account");
      }
    }
  }

  private releasePortalResources(): void {
    for (const unsubscribe of this.inboxUnsubscribes) unsubscribe();
    for (const channel of this.channels) channel.release();
  }

  private actor(role: ActorRole): SmokeActor {
    const actor = this.actors.get(role);
    assertSmoke(actor);
    return actor;
  }

  private actorPortal(actor: SmokeActor): Portal {
    assertSmoke(actor.portal);
    return actor.portal;
  }

  private actorPortalSession(actor: SmokeActor): PortalSessionPayload {
    assertSmoke(actor.portalSession);
    return actor.portalSession;
  }

  private config(): SmokeConfiguration {
    assertSmoke(this.configuration);
    return this.configuration;
  }

  private clerkClient(): ClerkClient {
    assertSmoke(this.clerk);
    return this.clerk;
  }

  private trackChannel<M>(channel: ChannelHandle<M>): ChannelHandle<M> {
    this.channels.add(channel);
    return channel;
  }

  private async appRequest(
    actor: SmokeActor,
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${actor.clerkToken}`);
    if (typeof init.body === "string")
      headers.set("Content-Type", "application/json");
    const response = await fetch(new URL(path, this.config().appOrigin), {
      ...init,
      headers,
      redirect: "manual",
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }

  private async createActor(
    role: SmokeActor["role"],
    userId: string,
  ): Promise<SmokeActor> {
    const session = await this.clerkClient().sessions.createSession({ userId });
    this.createdSessions.add(session.id);
    const token = await this.clerkClient().sessions.getToken(
      session.id,
      undefined,
      900,
    );
    return {
      role,
      userId,
      clerkSessionId: session.id,
      clerkToken: token.jwt,
      portalSession: null,
      portal: null,
    };
  }

  private async issuePortalSession(
    actor: SmokeActor,
  ): Promise<PortalSessionPayload> {
    const response = await this.appRequest(actor, "/api/office/portal/token", {
      method: "POST",
    });
    assertSmoke(response.status === 200 && isObject(response.body));
    const { token, channelIds, eventChannelId } = response.body;
    assertSmoke(
      typeof token === "string" &&
        Array.isArray(channelIds) &&
        channelIds.every((value) => typeof value === "string") &&
        typeof eventChannelId === "string",
    );
    const session = { token, channelIds, eventChannelId };
    actor.portalSession = session;
    actor.portal = new Portal({
      apiKey: this.config().portalPublishableKey,
      token,
    });
    return session;
  }

  private async verifySecurityPolicy(): Promise<void> {
    const config = this.config();
    const signedOut = await fetch(
      new URL("/api/office/session", config.appOrigin),
      {
        redirect: "manual",
      },
    );
    assertSmoke(signedOut.status === 401);

    const originRequest = (origin: string) =>
      fetch(`${PORTAL_API_URL}/v1/tokens/anonymous`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "x-portal-key": config.portalPublishableKey,
        },
        body: "{}",
      });
    const [allowed, unregistered] = await Promise.all([
      originRequest(config.appOrigin),
      originRequest(UNREGISTERED_ORIGIN),
    ]);
    assertSmoke(allowed.ok && !unregistered.ok);

    const currentOfficeDay = new Date().toISOString().slice(0, 10);
    const anonymousPortal = new Portal({ apiKey: config.portalPublishableKey });
    const anonymous = anonymousPortal.channel(`general:${currentOfficeDay}`);
    anonymous.acquire();
    await waitFor(
      () =>
        anonymous.status === "blocked" || anonymous.status === "reconnecting",
    );
    assertSmoke(anonymous.status !== "ready");
    anonymous.release();
  }

  private async verifyAuthenticatedIdentities(): Promise<void> {
    const config = this.config();
    const instance = await this.clerkClient().instance.get();
    assertSmoke(
      instance.environmentType === "development" ||
        instance.environmentType === "production",
    );
    if (config.runDisposableClerkLifecycle) {
      assertSmoke(instance.environmentType === "development");
    }

    const inputs = [
      ["new-hire-a", config.newHireAId, false],
      ["new-hire-b", config.newHireBId, false],
      ["operator", config.operatorId, true],
    ] as const;
    for (const [role, userId, expectedOperator] of inputs) {
      await this.clerkClient().users.getUser(userId);
      const actor = await this.createActor(role, userId);
      this.actors.set(role, actor);
      const session = await this.appRequest(actor, "/api/office/session");
      assertSmoke(session.status === 200 && isObject(session.body));
      assertSmoke(
        session.body.id === userId &&
          session.body.authentication === "clerk" &&
          session.body.isOperator === expectedOperator,
      );
      const portalSession = await this.issuePortalSession(actor);
      assertSmoke(portalSession.channelIds.length === 5);
    }

    const firstSession = this.actor("new-hire-a").portalSession;
    assertSmoke(firstSession);
    const general = firstSession.channelIds.find((id) =>
      id.startsWith("general:"),
    );
    assertSmoke(general);
    this.generalChannelId = general;
    this.officeDay = general.slice("general:".length);
    this.eventChannelId = firstSession.eventChannelId;
    for (const actor of this.actors.values()) {
      assertSmoke(
        actor.portalSession?.channelIds.includes(this.generalChannelId) &&
          actor.portalSession.eventChannelId === this.eventChannelId,
      );
    }
  }

  private async verifyOfficeDayOutbox(): Promise<void> {
    const runCron = async () => {
      const response = await fetch(
        new URL("/api/cron/office-days", this.config().appOrigin),
        { headers: { Authorization: `Bearer ${this.config().cronSecret}` } },
      );
      const body: unknown = await response.json().catch(() => null);
      assertSmoke(response.status === 200 && isObject(body));
      assertSmoke(body.planned === 5 && body.failed === 0);
    };
    await runCron();
    await runCron();

    const actor = this.actor("new-hire-a");
    const channel = this.trackChannel(
      await connectChannel<unknown>(
        this.actorPortal(actor),
        this.generalChannelId,
      ),
    );
    await loadUntil(channel, () =>
      channel.messages.some(
        (message) =>
          parseScriptedSystemEventMessage(message, this.generalChannelId) !==
          null,
      ),
    );
  }

  private async verifyPersistentDelivery(): Promise<void> {
    const actorA = this.actor("new-hire-a");
    const actorB = this.actor("new-hire-b");
    const operator = this.actor("operator");
    const newHireAChannel = this.trackChannel(
      await connectChannel<ChatContent>(
        this.actorPortal(actorA),
        this.generalChannelId,
      ),
    );
    const newHireBChannel = this.trackChannel(
      await connectChannel<ChatContent>(
        this.actorPortal(actorB),
        this.generalChannelId,
      ),
    );
    const operatorChannel = this.trackChannel(
      await connectChannel<ChatContent>(
        this.actorPortal(operator),
        this.generalChannelId,
      ),
    );
    this.newHireAChannel = newHireAChannel;
    this.newHireBChannel = newHireBChannel;
    this.operatorChannel = operatorChannel;

    const acknowledgement = await newHireAChannel.send({
      content: { text: uniqueSourceId("smoke-message") },
    });
    this.persistentMessageId = acknowledgement.id;
    await waitFor(() =>
      Boolean(messageById(newHireBChannel, acknowledgement.id)),
    );

    newHireBChannel.release();
    this.channels.delete(newHireBChannel);
    const reconnectedPortal = new Portal({
      apiKey: this.config().portalPublishableKey,
      token: this.actorPortalSession(actorB).token,
    });
    actorB.portal = reconnectedPortal;
    const reconnectedChannel = this.trackChannel(
      await connectChannel<ChatContent>(
        reconnectedPortal,
        this.generalChannelId,
      ),
    );
    this.newHireBChannel = reconnectedChannel;
    await loadUntil(reconnectedChannel, () =>
      Boolean(messageById(reconnectedChannel, acknowledgement.id)),
    );
  }

  private async verifyPresenceTypingUnread(): Promise<void> {
    assertSmoke(
      this.newHireAChannel && this.newHireBChannel && this.operatorChannel,
    );
    const newHireAChannel = this.newHireAChannel;
    const newHireBChannel = this.newHireBChannel;
    const actorA = this.actor("new-hire-a");
    const actorB = this.actor("new-hire-b");
    const operator = this.actor("operator");
    await waitFor(() => {
      const presence = newHireBChannel.presence;
      if (presence?.kind !== "detailed") return false;
      const ids = new Set(presence.participants.map(({ id }) => id));
      return (
        ids.has(actorA.userId) &&
        ids.has(actorB.userId) &&
        ids.has(operator.userId)
      );
    });

    newHireAChannel.sendTyping();
    await waitFor(() => newHireBChannel.typing.includes(actorA.userId));

    const inbox = this.actorPortal(actorB).inbox();
    const unsubscribe = inbox.subscribe(() => undefined);
    this.inboxUnsubscribes.push(unsubscribe);
    await waitFor(() => inbox.status === "ready");
    newHireBChannel.markAsRead();
    inbox.channels.get(this.generalChannelId)?.markAsRead();

    const acknowledgement = await newHireAChannel.send({
      content: { text: uniqueSourceId("smoke-unread-message") },
    });
    this.reportMessageId = acknowledgement.id;
    await waitFor(
      () =>
        Boolean(messageById(newHireBChannel, acknowledgement.id)) &&
        newHireBChannel.unread > 0 &&
        (inbox.channels.get(this.generalChannelId)?.unread ?? 0) > 0,
    );
    newHireBChannel.markAsRead();
    inbox.channels.get(this.generalChannelId)?.markAsRead();
    await waitFor(
      () =>
        newHireBChannel.unread === 0 &&
        inbox.channels.get(this.generalChannelId)?.unread === 0,
    );
  }

  private async verifyReactionReplay(): Promise<void> {
    const actorA = this.actor("new-hire-a");
    const actorB = this.actor("new-hire-b");
    const newHireAEventChannel = this.trackChannel(
      await connectChannel<unknown>(
        this.actorPortal(actorA),
        this.eventChannelId,
      ),
    );
    const newHireBEventChannel = this.trackChannel(
      await connectChannel<unknown>(
        this.actorPortal(actorB),
        this.eventChannelId,
      ),
    );
    this.newHireAEventChannel = newHireAEventChannel;
    this.newHireBEventChannel = newHireBEventChannel;
    const add = createReactionOfficeEvent({
      mutationId: uniqueSourceId("smoke-reaction-add"),
      occurredAt: new Date().toISOString(),
      officeDay: this.officeDay,
      officeChannelId: this.generalChannelId,
      messageId: this.persistentMessageId,
      actorId: actorA.userId,
      reaction: "👍",
      operation: "add",
    });
    const acknowledgement = await newHireAEventChannel.send({
      content: add,
      type: OFFICE_EVENT_MESSAGE_TYPE,
    });
    await waitFor(() =>
      Boolean(messageById(newHireBEventChannel, acknowledgement.id)),
    );
    const received = messageById(newHireBEventChannel, acknowledgement.id);
    assertSmoke(
      parseOfficeEventMessage(received, this.eventChannelId)?.event.type ===
        "reaction.changed",
    );

    newHireBEventChannel.release();
    this.channels.delete(newHireBEventChannel);
    const replayPortal = new Portal({
      apiKey: this.config().portalPublishableKey,
      token: this.actorPortalSession(actorB).token,
    });
    const replayChannel = this.trackChannel(
      await connectChannel<unknown>(replayPortal, this.eventChannelId),
    );
    this.newHireBEventChannel = replayChannel;
    await loadUntil(replayChannel, () => {
      const message = messageById(replayChannel, acknowledgement.id);
      return parseOfficeEventMessage(message, this.eventChannelId) !== null;
    });

    const remove = createReactionOfficeEvent({
      ...add,
      mutationId: uniqueSourceId("smoke-reaction-remove"),
      occurredAt: new Date().toISOString(),
      operation: "remove",
    });
    await newHireAEventChannel.send({
      content: remove,
      type: OFFICE_EVENT_MESSAGE_TYPE,
    });
  }

  private async profileBatch(
    actor: SmokeActor,
    clerkUserId: string,
  ): Promise<JsonObject> {
    const response = await this.appRequest(actor, "/api/office/profiles", {
      method: "POST",
      body: JSON.stringify({ clerkUserIds: [clerkUserId] }),
    });
    assertSmoke(response.status === 200 && isObject(response.body));
    const profiles = response.body.profiles;
    assertSmoke(Array.isArray(profiles) && isObject(profiles[0]));
    return profiles[0];
  }

  private async verifyReservedSenderRefusal(): Promise<void> {
    assertSmoke(this.newHireAEventChannel && this.newHireBEventChannel);
    const newHireAEventChannel = this.newHireAEventChannel;
    const newHireBEventChannel = this.newHireBEventChannel;
    const actorA = this.actor("new-hire-a");
    const before = await this.profileBatch(
      this.actor("new-hire-b"),
      actorA.userId,
    );
    const forged = {
      version: 1,
      type: "profile.invalidated",
      eventKey: createOfficeEventKey(
        "profile.invalidated",
        uniqueSourceId("smoke-forged-profile"),
      ),
      occurredAt: new Date().toISOString(),
      profileId: actorA.userId,
    } as const;
    const acknowledgement = await newHireAEventChannel.send({
      content: forged,
      type: OFFICE_EVENT_MESSAGE_TYPE,
    });
    await waitFor(() =>
      Boolean(messageById(newHireBEventChannel, acknowledgement.id)),
    );
    const message = messageById(newHireBEventChannel, acknowledgement.id);
    assertSmoke(parseOfficeEventMessage(message, this.eventChannelId) === null);
    const after = await this.profileBatch(
      this.actor("new-hire-b"),
      actorA.userId,
    );
    assertSmoke(JSON.stringify(before) === JSON.stringify(after));
  }

  private async verifyProfileInvalidation(): Promise<void> {
    assertSmoke(this.newHireBEventChannel);
    assertSmoke(this.newHireBChannel);
    const newHireBEventChannel = this.newHireBEventChannel;
    const newHireBChannel = this.newHireBChannel;
    const actorA = this.actor("new-hire-a");
    const current = await this.clerkClient().users.getUser(actorA.userId);
    this.originalProfile = {
      firstName: current.firstName ?? "",
      lastName: current.lastName ?? "",
    };
    const firstName = `Smoke${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const lastName = "Workflow";
    this.profileChanged = true;
    await this.clerkClient().users.updateUser(actorA.userId, {
      firstName,
      lastName,
    });
    const sessionRepair = await this.appRequest(actorA, "/api/office/session");
    assertSmoke(sessionRepair.status === 200);

    await waitFor(async () => {
      const profile = await this.profileBatch(
        this.actor("new-hire-b"),
        actorA.userId,
      );
      return (
        profile.status === "current" &&
        profile.displayName === `${firstName} ${lastName}`
      );
    }, WEBHOOK_WAIT_TIMEOUT_MS);
    await waitFor(
      () =>
        newHireBEventChannel.messages.some((message) => {
          const parsed = parseOfficeEventMessage(message, this.eventChannelId);
          return (
            parsed?.senderId === "office-events:profiles" &&
            parsed.event.type === "profile.invalidated" &&
            parsed.event.profileId === actorA.userId
          );
        }),
      WEBHOOK_WAIT_TIMEOUT_MS,
    );
    const historical = messageById(newHireBChannel, this.persistentMessageId);
    assertSmoke(historical?.sender.id === actorA.userId);
  }

  private async verifyHRReportsAndInbox(): Promise<void> {
    const operator = this.actor("operator");
    const operatorInbox = this.actorPortal(operator).inbox();
    const unsubscribe = operatorInbox.subscribe(() => undefined);
    this.inboxUnsubscribes.push(unsubscribe);
    await waitFor(() => operatorInbox.status === "ready");

    const actorB = this.actor("new-hire-b");
    const messageReport = await this.appRequest(
      actorB,
      "/api/office/hr-reports",
      {
        method: "POST",
        body: JSON.stringify({
          category: "harassment-or-bullying",
          officeChannelId: this.generalChannelId,
          messageId: this.reportMessageId,
        }),
      },
    );
    assertSmoke(
      (messageReport.status === 200 || messageReport.status === 201) &&
        isObject(messageReport.body) &&
        typeof messageReport.body.reportId === "string",
    );
    this.messageReportId = messageReport.body.reportId;

    const profileReport = await this.appRequest(
      actorB,
      "/api/office/hr-reports",
      {
        method: "POST",
        body: JSON.stringify({
          subjectType: "profile",
          category: "impersonation",
          profileId: this.actor("new-hire-a").userId,
        }),
      },
    );
    assertSmoke(
      (profileReport.status === 200 || profileReport.status === 201) &&
        isObject(profileReport.body) &&
        typeof profileReport.body.reportId === "string",
    );
    this.profileReportId = profileReport.body.reportId;

    await this.issuePortalSession(operator);
    const notificationIds = [this.messageReportId, this.profileReportId].map(
      (reportId) => `hr-report-notification:${reportId}`,
    );
    await waitFor(
      () =>
        notificationIds.every((id) =>
          operatorInbox.items.some((item) => item.id === id),
        ),
      WEBHOOK_WAIT_TIMEOUT_MS,
    );
    for (const id of notificationIds) {
      const item = operatorInbox.items.find((candidate) => candidate.id === id);
      assertSmoke(
        item && isObject(item.data) && typeof item.data.href === "string",
      );
      const href = new URL(item.data.href);
      assertSmoke(href.origin === this.config().appOrigin);
      assertSmoke(
        !/category|reporter|private|reason|messageBody|displayName|imageUrl/iu.test(
          JSON.stringify(item.data),
        ),
      );
    }

    const queue = await this.appRequest(
      operator,
      "/api/office/operator/hr-reports",
    );
    assertSmoke(queue.status === 200 && isObject(queue.body));
    const reports = queue.body.reports;
    assertSmoke(
      Array.isArray(reports) &&
        reports.some(
          (report) =>
            isObject(report) && report.reportId === this.messageReportId,
        ) &&
        reports.some(
          (report) =>
            isObject(report) && report.reportId === this.profileReportId,
        ),
    );
  }

  private async verifyRemovedMessage(): Promise<void> {
    const operator = this.actor("operator");
    const requestBody = JSON.stringify({
      officeChannelId: this.generalChannelId,
      messageId: this.reportMessageId,
      privateReason: uniqueSourceId("smoke-removal-private"),
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.appRequest(
        operator,
        "/api/office/operator/message-removals",
        { method: "POST", body: requestBody },
      );
      assertSmoke(
        (response.status === 200 || response.status === 201) &&
          isObject(response.body),
      );
    }
    this.messageReportId = null;

    const projectionPath = `/api/office/message-removals?officeChannelId=${encodeURIComponent(this.generalChannelId)}`;
    for (const actor of [this.actor("new-hire-a"), this.actor("new-hire-b")]) {
      const response = await this.appRequest(actor, projectionPath);
      assertSmoke(response.status === 200 && isObject(response.body));
      assertSmoke(
        Array.isArray(response.body.removals) &&
          response.body.removals.some(
            (removal) =>
              isObject(removal) && removal.messageId === this.reportMessageId,
          ),
      );
    }

    assertSmoke(this.newHireAChannel);
    assertSmoke(messageById(this.newHireAChannel, this.reportMessageId));
    const actorB = this.actor("new-hire-b");
    const historicalPortal = new Portal({
      apiKey: this.config().portalPublishableKey,
      token: this.actorPortalSession(actorB).token,
    });
    const historical = this.trackChannel(
      await connectChannel<ChatContent>(
        historicalPortal,
        this.generalChannelId,
      ),
    );
    await loadUntil(historical, () =>
      Boolean(messageById(historical, this.reportMessageId)),
    );
    const projection = await this.appRequest(actorB, projectionPath);
    assertSmoke(
      isObject(projection.body) &&
        Array.isArray(projection.body.removals) &&
        projection.body.removals.some(
          (removal) =>
            isObject(removal) && removal.messageId === this.reportMessageId,
        ),
    );
  }

  private async verifyTerminationLifecycle(): Promise<void> {
    const operator = this.actor("operator");
    const target = this.actor("new-hire-b");
    const requestId = uniqueSourceId("smoke-termination");
    const privateReason = uniqueSourceId("smoke-termination-private");
    this.terminationActive = true;
    const termination = await this.appRequest(
      operator,
      "/api/office/operator/termination",
      {
        method: "POST",
        body: JSON.stringify({
          requestId,
          targetNewHireId: target.userId,
          privateReason,
        }),
      },
    );
    assertSmoke(
      termination.status === 200 &&
        isObject(termination.body) &&
        typeof termination.body.terminationId === "string",
    );
    const retry = await this.appRequest(
      operator,
      "/api/office/operator/termination",
      {
        method: "POST",
        body: JSON.stringify({
          requestId,
          targetNewHireId: target.userId,
          privateReason,
        }),
      },
    );
    assertSmoke(retry.status === 200 && isObject(retry.body));
    assertSmoke(retry.body.terminationId === termination.body.terminationId);

    const employment = await this.appRequest(target, "/api/office/employment");
    assertSmoke(
      employment.status === 200 &&
        isObject(employment.body) &&
        employment.body.eligible === false &&
        employment.body.reason === "terminated",
    );
    const denied = await this.appRequest(target, "/api/office/portal/token", {
      method: "POST",
    });
    assertSmoke(denied.status === 403);
    assertSmoke(this.newHireBChannel);
    await waitFor(() => this.newHireBChannel?.status === "blocked");
    const blocked = this.trackChannel(
      await expectBlockedChannel<ChatContent>(
        new Portal({
          apiKey: this.config().portalPublishableKey,
          token: this.actorPortalSession(target).token,
        }),
        this.generalChannelId,
      ),
    );
    assertSmoke(blocked.status !== "ready");

    const reinstatement = await this.appRequest(
      operator,
      "/api/office/operator/termination",
      {
        method: "PATCH",
        body: JSON.stringify({
          requestId: uniqueSourceId("smoke-reinstatement"),
          targetNewHireId: target.userId,
          privateReason: uniqueSourceId("smoke-reinstatement-private"),
        }),
      },
    );
    assertSmoke(reinstatement.status === 200);
    this.terminationActive = false;
    const access = await this.appRequest(target, "/api/office/employment");
    assertSmoke(
      access.status === 200 &&
        isObject(access.body) &&
        access.body.eligible === true,
    );
    const session = await this.issuePortalSession(target);
    const generalChannelId = session.channelIds.find((id) =>
      id.startsWith("general:"),
    );
    assertSmoke(generalChannelId);
    const reconnected = this.trackChannel(
      await connectChannel<ChatContent>(
        this.actorPortal(target),
        generalChannelId,
      ),
    );
    assertSmoke(reconnected.status === "ready");
  }

  private async onboardDisposable(actor: SmokeActor): Promise<void> {
    const initial = await this.appRequest(actor, "/api/office/session");
    assertSmoke(initial.status === 200);
    const profileForm = new FormData();
    profileForm.set("intent", "confirm-profile");
    profileForm.set("firstName", "Smoke");
    profileForm.set("lastName", "Disposable");
    const profile = await this.appRequest(actor, "/api/office/onboarding", {
      method: "POST",
      body: profileForm,
    });
    assertSmoke(profile.status === 200);
    const conductForm = new FormData();
    conductForm.set("intent", "accept-conduct");
    conductForm.set("accepted", "yes");
    assertSmoke(
      (
        await this.appRequest(actor, "/api/office/onboarding", {
          method: "POST",
          body: conductForm,
        })
      ).status === 200,
    );
    const clockInForm = new FormData();
    clockInForm.set("intent", "clock-in");
    assertSmoke(
      (
        await this.appRequest(actor, "/api/office/onboarding", {
          method: "POST",
          body: clockInForm,
        })
      ).status === 200,
    );
    await this.issuePortalSession(actor);
  }

  private async createDisposable(kind: string): Promise<SmokeActor> {
    const suffix = randomUUID().replaceAll("-", "");
    const user = await this.clerkClient().users.createUser({
      externalId: `portal-messenger-smoke-${kind}-${suffix}`,
      emailAddress: [`portal.messenger.smoke+${suffix}@example.com`],
      firstName: "Smoke",
      lastName: "Disposable",
    });
    this.disposableUserIds.add(user.id);
    const actor = await this.createActor("disposable", user.id);
    this.disposableActors.push(actor);
    await this.onboardDisposable(actor);
    return actor;
  }

  private async verifyDisposableLifecycle(): Promise<void> {
    const operator = this.actor("operator");
    const sentHome = await this.createDisposable("send-home");
    const sentHomePortal = this.actorPortal(sentHome);
    const sentHomeSession = this.actorPortalSession(sentHome);
    const sentHomeChannelId = sentHomeSession.channelIds.find((id) =>
      id.startsWith("general:"),
    );
    assertSmoke(sentHomeChannelId);
    const sentHomeOfficeDay = sentHomeChannelId.slice("general:".length);
    const sentHomeChannel = this.trackChannel(
      await connectChannel<ChatContent>(sentHomePortal, sentHomeChannelId),
    );
    const action = await this.appRequest(
      operator,
      "/api/office/operator/send-home",
      {
        method: "POST",
        body: JSON.stringify({
          requestId: uniqueSourceId("smoke-send-home"),
          targetNewHireId: sentHome.userId,
          privateReason: uniqueSourceId("smoke-send-home-private"),
        }),
      },
    );
    assertSmoke(
      action.status === 200 &&
        isObject(action.body) &&
        action.body.expiresAt === nextUtcOfficeDayBoundary(sentHomeOfficeDay),
    );
    await waitFor(() => sentHomeChannel.status === "blocked");
    const sentHomeAccess = await this.appRequest(
      sentHome,
      "/api/office/employment",
    );
    assertSmoke(
      sentHomeAccess.status === 200 &&
        isObject(sentHomeAccess.body) &&
        sentHomeAccess.body.reason === "sent-home" &&
        sentHomeAccess.body.until ===
          nextUtcOfficeDayBoundary(sentHomeOfficeDay),
    );
    assertSmoke(
      (
        await this.appRequest(sentHome, "/api/office/portal/token", {
          method: "POST",
        })
      ).status === 403,
    );

    const deleted = await this.createDisposable("clerk-deletion");
    const deletedPortal = this.actorPortal(deleted);
    const deletedSession = this.actorPortalSession(deleted);
    const deletedChannel = this.trackChannel(
      await connectChannel<ChatContent>(deletedPortal, this.generalChannelId),
    );
    const oldPortalToken = deletedSession.token;
    await this.clerkClient().users.deleteUser(deleted.userId);
    this.deletedDisposableIds.add(deleted.userId);
    await waitFor(async () => {
      const profile = await this.profileBatch(
        this.actor("new-hire-a"),
        deleted.userId,
      );
      return (
        profile.status === "former" &&
        profile.displayName === "Former Employee" &&
        profile.imageUrl === null
      );
    }, WEBHOOK_WAIT_TIMEOUT_MS);
    await waitFor(
      () => deletedChannel.status === "blocked",
      WEBHOOK_WAIT_TIMEOUT_MS,
    );
    const denied = await this.appRequest(deleted, "/api/office/portal/token", {
      method: "POST",
    });
    assertSmoke(denied.status === 401 || denied.status === 403);
    const blocked = this.trackChannel(
      await expectBlockedChannel<ChatContent>(
        new Portal({
          apiKey: this.config().portalPublishableKey,
          token: oldPortalToken,
        }),
        this.generalChannelId,
      ),
    );
    assertSmoke(blocked.status !== "ready");
  }
}
