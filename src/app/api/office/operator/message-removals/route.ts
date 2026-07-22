import { createServiceAdapters } from "@/lib/adapters";
import { isOperatorUserId } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import type {
  MessageRemovalInvalidationPublisher,
  MessageRemovalRepository,
} from "@/lib/message-removals/contract";
import { parseMessageRemovalRequest } from "@/lib/message-removals/domain";
import { removeMessage } from "@/lib/message-removals/service";
import { officeDay } from "@/lib/portal/office-day";
import { officeNowForRequest } from "@/lib/portal/request-time";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
} as const;

type OperatorMessageRemovalDependencies = {
  repository: MessageRemovalRepository;
  publisher: MessageRemovalInvalidationPublisher;
  requesterId: string;
  operatorUserIds?: string;
  now: Date;
};

export async function handleOperatorMessageRemovalRequest(
  request: Request,
  dependencies: OperatorMessageRemovalDependencies,
): Promise<Response> {
  if (
    !isOperatorUserId(dependencies.requesterId, dependencies.operatorUserIds)
  ) {
    return Response.json(
      { error: "operator_required" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const payload: unknown = await request.json().catch(() => null);
  const currentOfficeDay = officeDay(dependencies.now);
  const input = parseMessageRemovalRequest(payload, currentOfficeDay);
  if (!input) {
    return Response.json(
      { error: "invalid_message_removal" },
      { status: 422, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const result = await removeMessage({
    repository: dependencies.repository,
    publisher: dependencies.publisher,
    operatorId: dependencies.requesterId,
    officeDay: currentOfficeDay,
    now: dependencies.now,
    ...input,
  });
  return Response.json(result, {
    status: result.status === "removed" ? 201 : 200,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const adapters = createServiceAdapters(configuration);
  const onboarding = await adapters.neon.getNewHire(identity.id);
  if (!onboarding?.completedAt || onboarding.step !== "complete") {
    return Response.json(
      { error: "new_hire_ineligible" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return handleOperatorMessageRemovalRequest(request, {
    repository: adapters.neon,
    publisher: adapters.portal,
    requesterId: identity.id,
    operatorUserIds: process.env.OPERATOR_CLERK_USER_IDS,
    now: officeNowForRequest(request.headers, configuration),
  });
}
