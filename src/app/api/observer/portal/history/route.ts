import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";
import type { MessageRemovalRepository } from "@/lib/message-removals/contract";
import { listMessageRemovals } from "@/lib/message-removals/service";
import { isOfficeChannelSlug, listOfficeChannels } from "@/lib/portal/channels";
import { projectObserverChannelHistory } from "@/lib/portal/observer";
import { createPortalObserverHistoryReader } from "@/lib/portal/server";
import {
  SAFETY_PROJECTION_TIMEOUT_MS,
  safetyProjectionUnavailableResponse,
} from "@/lib/safety/contract";
import {
  logSafetyEvent,
  requestCorrelationId,
  type SafetyBoundaryOptions,
  withSafetyDependencyTimeout,
} from "@/lib/safety/server";

export const runtime = "nodejs";

const OBSERVER_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3, stale-while-revalidate=6",
} as const;

type ObserverHistoryReader = {
  readChannelHistory(channelId: string): Promise<readonly unknown[]>;
};

class ObserverHistoryDependencyError extends Error {
  constructor(readonly authority: "portal" | "neon") {
    super("Observer history dependency is unavailable.");
  }
}

export async function handleObserverHistoryRequest(
  request: Request,
  dependencies: {
    portal: ObserverHistoryReader;
    repository: MessageRemovalRepository;
  },
  now = new Date(),
  options: SafetyBoundaryOptions = {},
): Promise<Response> {
  const requestedSlug = new URL(request.url).searchParams.get("channel");
  if (!requestedSlug || !isOfficeChannelSlug(requestedSlug)) {
    return Response.json(
      { error: "invalid_office_channel" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  const channel = listOfficeChannels(now).find(
    ({ slug }) => slug === requestedSlug,
  );
  if (!channel) {
    return Response.json(
      { error: "invalid_office_channel" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const timeoutMs = options.timeoutMs ?? SAFETY_PROJECTION_TIMEOUT_MS;
  try {
    const historyPromise = withSafetyDependencyTimeout(
      dependencies.portal.readChannelHistory(channel.id),
      timeoutMs,
    ).catch(() => {
      throw new ObserverHistoryDependencyError("portal");
    });
    const removalsPromise = withSafetyDependencyTimeout(
      listMessageRemovals({
        repository: dependencies.repository,
        officeChannelId: channel.id,
      }),
      timeoutMs,
    ).catch(() => {
      throw new ObserverHistoryDependencyError("neon");
    });
    const [history, removals] = await Promise.all([
      historyPromise,
      removalsPromise,
    ]);
    const removedMessageIds = new Set(
      removals.map(({ messageId }) => messageId),
    );
    const messages = projectObserverChannelHistory(
      history,
      channel.id,
      removedMessageIds,
    );
    return Response.json(
      { channelId: channel.id, messages },
      { headers: OBSERVER_CACHE_HEADERS },
    );
  } catch (error) {
    const correlationId =
      options.correlationId ?? requestCorrelationId(request.headers);
    (options.logger ?? logSafetyEvent)({
      operation: "observer_history",
      correlationId,
      authority:
        error instanceof ObserverHistoryDependencyError
          ? error.authority
          : "portal",
      status: "unavailable",
      officeChannelId: channel.id,
    });
    return safetyProjectionUnavailableResponse(correlationId);
  }
}

export async function GET(request: Request) {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json(
      { error: "installation_incomplete" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const adapters = createServiceAdapters(configuration);
  const portal = createPortalObserverHistoryReader({
    secret: configuration.values.PORTAL_SECRET,
    apiKey: configuration.values.NEXT_PUBLIC_PORTAL_KEY,
  });
  return handleObserverHistoryRequest(request, {
    portal,
    repository: adapters.neon,
  });
}
