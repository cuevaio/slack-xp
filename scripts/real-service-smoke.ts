import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  formatSmokeReport,
  inspectSmokeEnvironment,
  runSmokeContract,
} from "@/lib/smoke/contract";
import { LiveRealServiceSmokeAdapter } from "@/lib/smoke/live";

function parseArguments(args: string[]): {
  preflight: boolean;
  artifactPath: string | null;
} {
  let preflight = false;
  let artifactPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--preflight") {
      preflight = true;
      continue;
    }
    if (argument === "--artifact") {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("invalid_arguments");
      artifactPath = value;
      index += 1;
      continue;
    }
    throw new Error("invalid_arguments");
  }
  return { preflight, artifactPath };
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2));
  if (args.preflight) {
    const inspection = inspectSmokeEnvironment(process.env);
    if (inspection.status === "unavailable") {
      console.log(
        `UNAVAILABLE: Set or correct protected environment values: ${inspection.issues.join(", ")}. No service calls were made.`,
      );
      return 2;
    }
    console.log(
      "READY: protected real-service smoke configuration is complete; no service calls were made.",
    );
    return 0;
  }

  const report = await runSmokeContract(
    process.env,
    new LiveRealServiceSmokeAdapter(),
  );
  console.log(formatSmokeReport(report));
  if (args.artifactPath) {
    await mkdir(dirname(args.artifactPath), { recursive: true });
    await writeFile(args.artifactPath, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  return report.exitCode;
}

try {
  process.exitCode = await main();
} catch {
  console.error(
    "NOT READY: the smoke command could not start. Check fixed arguments and protected environment configuration.",
  );
  process.exitCode = 1;
}
