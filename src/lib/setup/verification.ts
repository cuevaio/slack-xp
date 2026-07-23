import {
  type AppConfiguration,
  type AppEnvironment,
  type EnvironmentSource,
  readAppConfiguration,
} from "@/lib/config";

export type SetupCheckStatus = "pass" | "fail" | "unavailable";

export type SetupCheck = {
  id: string;
  label: string;
  status: SetupCheckStatus;
  correctiveAction: string;
};

export type PortalVerificationEvidence = {
  anonymousRefused: boolean;
  authenticated: boolean;
  published: boolean;
  membership: boolean;
  mode: "standard" | "broadcast" | null;
  allowedOriginAccepted: boolean;
  unregisteredOriginRefused: boolean | null;
  persistedAfterReconnect: boolean;
};

type NeonVerificationEvidence = { migrations: "current" | "drift" };
type ClerkVerificationEvidence = {
  environment: "development" | "production";
};

export type SetupVerifier = {
  verifyNeon(): Promise<NeonVerificationEvidence>;
  verifyClerk(): Promise<ClerkVerificationEvidence>;
  verifyPortal(): Promise<PortalVerificationEvidence>;
};

export type SetupReport = {
  environment: AppEnvironment;
  checks: SetupCheck[];
  exitCode: 0 | 1 | 2;
};

const NO_ACTION_REQUIRED = "No action required.";

const PORTAL_CHECK_DEFINITIONS = [
  ["portal-anonymous-refusal", "Portal anonymous refusal", "fail"],
  ["portal-authenticated-publish", "Portal authenticated publish", "fail"],
  ["portal-membership-mode", "Portal membership and mode", "fail"],
  ["portal-allowed-origin", "Portal allowed origin", "fail"],
  [
    "portal-unregistered-origin",
    "Portal unregistered origin refusal",
    "unavailable",
  ],
  ["portal-persistence", "Portal reconnect persistence", "fail"],
] as const;

const SERVICE_CHECK_DEFINITIONS = [
  ["neon-connectivity", "Neon connectivity"],
  ["neon-migrations", "Neon migration state"],
  ["clerk-credentials", "Clerk credentials"],
  ["clerk-webhook", "Clerk webhook observables"],
  ...PORTAL_CHECK_DEFINITIONS,
] as const;

function createCheck(
  id: string,
  label: string,
  status: SetupCheckStatus,
  correctiveAction: string,
): SetupCheck {
  return { id, label, status, correctiveAction };
}

function createOutcomeCheck(
  id: string,
  label: string,
  passed: boolean,
  correctiveAction: string,
): SetupCheck {
  return createCheck(
    id,
    label,
    passed ? "pass" : "fail",
    passed ? NO_ACTION_REQUIRED : correctiveAction,
  );
}

function unavailableServiceChecks(reason: string): SetupCheck[] {
  return SERVICE_CHECK_DEFINITIONS.map(([id, label]) =>
    createCheck(id, label, "unavailable", reason),
  );
}

function createConfigurationCheck(configuration: AppConfiguration): SetupCheck {
  if (configuration.status === "ready") {
    return createCheck(
      "configuration",
      "Environment configuration",
      "pass",
      NO_ACTION_REQUIRED,
    );
  }

  const invalid = configuration.issues.filter(
    (issue) => issue.reason !== "missing",
  );
  const issues = invalid.length > 0 ? invalid : configuration.issues;
  const names = [...new Set(issues.map((issue) => issue.name))].sort();
  return createCheck(
    "configuration",
    "Environment configuration",
    invalid.length > 0 ? "fail" : "unavailable",
    `${invalid.length > 0 ? "Correct invalid or forbidden" : "Set required"} variables: ${names.join(", ")}.`,
  );
}

function computeExitCode(
  environment: AppEnvironment,
  checks: readonly SetupCheck[],
): 0 | 1 | 2 {
  if (checks.some((item) => item.status === "fail")) {
    return 1;
  }

  if (checks.some((item) => item.status === "unavailable")) {
    return environment === "production" ? 1 : 2;
  }

  return 0;
}

function createSetupReport(
  environment: AppEnvironment,
  checks: SetupCheck[],
): SetupReport {
  return {
    environment,
    checks,
    exitCode: computeExitCode(environment, checks),
  };
}

function createNeonChecks(
  result: PromiseSettledResult<NeonVerificationEvidence>,
): SetupCheck[] {
  if (result.status === "rejected") {
    return [
      createCheck(
        "neon-connectivity",
        "Neon connectivity",
        "fail",
        "Confirm DATABASE_URL, Neon availability, and network access.",
      ),
      createCheck(
        "neon-migrations",
        "Neon migration state",
        "unavailable",
        "Restore Neon connectivity, then rerun the check.",
      ),
    ];
  }

  const migrationsCurrent = result.value.migrations === "current";
  return [
    createCheck(
      "neon-connectivity",
      "Neon connectivity",
      "pass",
      NO_ACTION_REQUIRED,
    ),
    createOutcomeCheck(
      "neon-migrations",
      "Neon migration state",
      migrationsCurrent,
      "Run bun run db:migrate with this environment's DATABASE_URL, then rerun the check.",
    ),
  ];
}

function createClerkChecks(
  environment: AppEnvironment,
  result: PromiseSettledResult<ClerkVerificationEvidence>,
): SetupCheck[] {
  if (result.status === "rejected") {
    return [
      createCheck(
        "clerk-credentials",
        "Clerk credentials",
        "fail",
        "Confirm the Clerk key pair and service availability.",
      ),
      createCheck(
        "clerk-webhook",
        "Clerk webhook observables",
        "unavailable",
        "Restore Clerk credential verification, then confirm the webhook endpoint.",
      ),
    ];
  }

  const expectedEnvironment =
    environment === "production" ? "production" : "development";
  const stackMatches = result.value.environment === expectedEnvironment;
  return [
    createOutcomeCheck(
      "clerk-credentials",
      "Clerk credentials",
      stackMatches,
      `Use a ${expectedEnvironment} Clerk application for this deployment scope.`,
    ),
    createCheck(
      "clerk-webhook",
      "Clerk webhook observables",
      "pass",
      "Confirm the Dashboard endpoint subscribes to user.created, user.updated, and user.deleted.",
    ),
  ];
}

function getUnregisteredOriginStatus(
  refused: boolean | null,
): SetupCheckStatus {
  if (refused === null) {
    return "unavailable";
  }

  return refused ? "pass" : "fail";
}

function createPortalChecks(
  result: PromiseSettledResult<PortalVerificationEvidence>,
): SetupCheck[] {
  if (result.status === "rejected") {
    return PORTAL_CHECK_DEFINITIONS.map(([id, label, rejectedStatus]) =>
      createCheck(
        id,
        label,
        rejectedStatus,
        "Confirm Portal credentials, deployment, channel policy, origins, and service availability.",
      ),
    );
  }

  const evidence = result.value;
  const authenticatedPublish = evidence.authenticated && evidence.published;
  const standardMembership =
    evidence.membership && evidence.mode === "standard";

  return [
    createOutcomeCheck(
      "portal-anonymous-refusal",
      "Portal anonymous refusal",
      evidence.anonymousRefused,
      "Deploy portal.config.ts with anonymous access disabled.",
    ),
    createOutcomeCheck(
      "portal-authenticated-publish",
      "Portal authenticated publish",
      authenticatedPublish,
      "Confirm the secret and publishable keys share an environment and permit authenticated publishing.",
    ),
    createOutcomeCheck(
      "portal-membership-mode",
      "Portal membership and mode",
      standardMembership,
      "Redeploy the required standard Office Channel policy and membership.",
    ),
    createOutcomeCheck(
      "portal-allowed-origin",
      "Portal allowed origin",
      evidence.allowedOriginAccepted,
      "Register APP_ORIGIN in the Portal environment's allowed origins.",
    ),
    createCheck(
      "portal-unregistered-origin",
      "Portal unregistered origin refusal",
      getUnregisteredOriginStatus(evidence.unregisteredOriginRefused),
      evidence.unregisteredOriginRefused
        ? NO_ACTION_REQUIRED
        : "Confirm Portal rejects a non-loopback origin not present in the allowlist.",
    ),
    createOutcomeCheck(
      "portal-persistence",
      "Portal reconnect persistence",
      evidence.persistedAfterReconnect,
      "Confirm persistent history is enabled and available after a fresh connection.",
    ),
  ];
}

export async function runSetupVerification(
  env: EnvironmentSource,
  verifier: SetupVerifier,
): Promise<SetupReport> {
  const configuration = readAppConfiguration(env);
  const environment = configuration.environment;
  const configurationCheck = createConfigurationCheck(configuration);

  if (configuration.status !== "ready") {
    const checks = [
      configurationCheck,
      ...unavailableServiceChecks(
        "Complete environment configuration before contacting services.",
      ),
    ];
    return createSetupReport(environment, checks);
  }

  if (configuration.serviceMode === "mock") {
    const checks = [
      configurationCheck,
      ...unavailableServiceChecks(
        "Set SERVICE_MODE=live and provide service credentials to collect live proof.",
      ),
    ];
    return createSetupReport(environment, checks);
  }

  const [neon, clerk, portal] = await Promise.allSettled([
    verifier.verifyNeon(),
    verifier.verifyClerk(),
    verifier.verifyPortal(),
  ]);
  const checks = [
    configurationCheck,
    ...createNeonChecks(neon),
    ...createClerkChecks(environment, clerk),
    ...createPortalChecks(portal),
  ];

  return createSetupReport(environment, checks);
}

const STATUS_LABELS: Record<SetupCheckStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  unavailable: "UNAVAILABLE",
};

export function formatSetupReport(report: SetupReport): string {
  const lines = [
    `Portal Messenger setup verification (${report.environment})`,
    ...report.checks.map(
      (item) =>
        `[${STATUS_LABELS[item.status]}] ${item.label}: ${item.correctiveAction}`,
    ),
  ];

  if (report.exitCode === 0) {
    lines.push("READY: all required checks are proven.");
  } else if (report.exitCode === 2) {
    lines.push("UNAVAILABLE: live readiness was not proven.");
  } else {
    lines.push("NOT READY: correct failed or unproven checks.");
  }

  return lines.join("\n");
}
