import {
  type AppEnvironment,
  detectAppEnvironment,
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

export type SetupVerifier = {
  verifyNeon(): Promise<{ migrations: "current" | "drift" }>;
  verifyClerk(): Promise<{ environment: "development" | "production" }>;
  verifyPortal(): Promise<PortalVerificationEvidence>;
};

export type SetupReport = {
  environment: AppEnvironment;
  checks: SetupCheck[];
  exitCode: 0 | 1 | 2;
};

const serviceCheckIds = [
  ["neon-connectivity", "Neon connectivity"],
  ["neon-migrations", "Neon migration state"],
  ["clerk-credentials", "Clerk credentials"],
  ["clerk-webhook", "Clerk webhook observables"],
  ["portal-anonymous-refusal", "Portal anonymous refusal"],
  ["portal-authenticated-publish", "Portal authenticated publish"],
  ["portal-membership-mode", "Portal membership and mode"],
  ["portal-allowed-origin", "Portal allowed origin"],
  ["portal-unregistered-origin", "Portal unregistered origin refusal"],
  ["portal-persistence", "Portal reconnect persistence"],
] as const;

function check(
  id: string,
  label: string,
  status: SetupCheckStatus,
  correctiveAction: string,
): SetupCheck {
  return { id, label, status, correctiveAction };
}

function unavailableServiceChecks(reason: string): SetupCheck[] {
  return serviceCheckIds.map(([id, label]) =>
    check(id, label, "unavailable", reason),
  );
}

function configurationCheck(env: EnvironmentSource): SetupCheck {
  const configuration = readAppConfiguration(env);
  if (configuration.status === "ready") {
    return check(
      "configuration",
      "Environment configuration",
      "pass",
      "No action required.",
    );
  }

  const invalid = configuration.issues.filter(
    (issue) => issue.reason !== "missing",
  );
  const issues = invalid.length > 0 ? invalid : configuration.issues;
  const names = [...new Set(issues.map((issue) => issue.name))].sort();
  return check(
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
  if (checks.some((item) => item.status === "fail")) return 1;
  if (checks.some((item) => item.status === "unavailable")) {
    return environment === "production" ? 1 : 2;
  }
  return 0;
}

export async function runSetupVerification(
  env: EnvironmentSource,
  verifier: SetupVerifier,
): Promise<SetupReport> {
  const environment = detectAppEnvironment(env);
  const config = configurationCheck(env);
  const configuration = readAppConfiguration(env);
  if (configuration.status !== "ready") {
    const checks = [
      config,
      ...unavailableServiceChecks(
        "Complete environment configuration before contacting services.",
      ),
    ];
    return {
      environment,
      checks,
      exitCode: computeExitCode(environment, checks),
    };
  }

  if (configuration.serviceMode === "mock") {
    const checks = [
      config,
      ...unavailableServiceChecks(
        "Set SERVICE_MODE=live and provide service credentials to collect live proof.",
      ),
    ];
    return {
      environment,
      checks,
      exitCode: computeExitCode(environment, checks),
    };
  }

  const [neon, clerk, portal] = await Promise.allSettled([
    verifier.verifyNeon(),
    verifier.verifyClerk(),
    verifier.verifyPortal(),
  ]);
  const checks: SetupCheck[] = [config];

  if (neon.status === "rejected") {
    checks.push(
      check(
        "neon-connectivity",
        "Neon connectivity",
        "fail",
        "Confirm DATABASE_URL, Neon availability, and network access.",
      ),
      check(
        "neon-migrations",
        "Neon migration state",
        "unavailable",
        "Restore Neon connectivity, then rerun the check.",
      ),
    );
  } else {
    checks.push(
      check(
        "neon-connectivity",
        "Neon connectivity",
        "pass",
        "No action required.",
      ),
      check(
        "neon-migrations",
        "Neon migration state",
        neon.value.migrations === "current" ? "pass" : "fail",
        neon.value.migrations === "current"
          ? "No action required."
          : "Run bun run db:migrate with this environment's DATABASE_URL, then rerun the check.",
      ),
    );
  }

  if (clerk.status === "rejected") {
    checks.push(
      check(
        "clerk-credentials",
        "Clerk credentials",
        "fail",
        "Confirm the Clerk key pair and service availability.",
      ),
      check(
        "clerk-webhook",
        "Clerk webhook observables",
        "unavailable",
        "Restore Clerk credential verification, then confirm the webhook endpoint.",
      ),
    );
  } else {
    const expectedEnvironment =
      environment === "production" ? "production" : "development";
    const stackMatches = clerk.value.environment === expectedEnvironment;
    checks.push(
      check(
        "clerk-credentials",
        "Clerk credentials",
        stackMatches ? "pass" : "fail",
        stackMatches
          ? "No action required."
          : `Use a ${expectedEnvironment} Clerk application for this deployment scope.`,
      ),
      check(
        "clerk-webhook",
        "Clerk webhook observables",
        "pass",
        "Confirm the Dashboard endpoint subscribes to user.created and user.updated.",
      ),
    );
  }

  if (portal.status === "rejected") {
    checks.push(
      ...serviceCheckIds
        .slice(4)
        .map(([id, label]) =>
          check(
            id,
            label,
            id === "portal-unregistered-origin" ? "unavailable" : "fail",
            "Confirm Portal credentials, deployment, channel policy, origins, and service availability.",
          ),
        ),
    );
  } else {
    const evidence = portal.value;
    checks.push(
      check(
        "portal-anonymous-refusal",
        "Portal anonymous refusal",
        evidence.anonymousRefused ? "pass" : "fail",
        evidence.anonymousRefused
          ? "No action required."
          : "Deploy portal.config.ts with anonymous access disabled.",
      ),
      check(
        "portal-authenticated-publish",
        "Portal authenticated publish",
        evidence.authenticated && evidence.published ? "pass" : "fail",
        evidence.authenticated && evidence.published
          ? "No action required."
          : "Confirm the secret and publishable keys share an environment and permit authenticated publishing.",
      ),
      check(
        "portal-membership-mode",
        "Portal membership and mode",
        evidence.membership && evidence.mode === "standard" ? "pass" : "fail",
        evidence.membership && evidence.mode === "standard"
          ? "No action required."
          : "Redeploy the required standard Office Channel policy and membership.",
      ),
      check(
        "portal-allowed-origin",
        "Portal allowed origin",
        evidence.allowedOriginAccepted ? "pass" : "fail",
        evidence.allowedOriginAccepted
          ? "No action required."
          : "Register APP_ORIGIN in the Portal environment's allowed origins.",
      ),
      check(
        "portal-unregistered-origin",
        "Portal unregistered origin refusal",
        evidence.unregisteredOriginRefused === null
          ? "unavailable"
          : evidence.unregisteredOriginRefused
            ? "pass"
            : "fail",
        evidence.unregisteredOriginRefused
          ? "No action required."
          : "Confirm Portal rejects a non-loopback origin not present in the allowlist.",
      ),
      check(
        "portal-persistence",
        "Portal reconnect persistence",
        evidence.persistedAfterReconnect ? "pass" : "fail",
        evidence.persistedAfterReconnect
          ? "No action required."
          : "Confirm persistent history is enabled and available after a fresh connection.",
      ),
    );
  }

  return {
    environment,
    checks,
    exitCode: computeExitCode(environment, checks),
  };
}

const statusSymbol: Record<SetupCheckStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  unavailable: "UNAVAILABLE",
};

export function formatSetupReport(report: SetupReport): string {
  const lines = [
    `Portal Messenger setup verification (${report.environment})`,
    ...report.checks.map(
      (item) =>
        `[${statusSymbol[item.status]}] ${item.label}: ${item.correctiveAction}`,
    ),
  ];
  if (report.exitCode === 0)
    lines.push("READY: all required checks are proven.");
  else if (report.exitCode === 2)
    lines.push("UNAVAILABLE: live readiness was not proven.");
  else lines.push("NOT READY: correct failed or unproven checks.");
  return lines.join("\n");
}
