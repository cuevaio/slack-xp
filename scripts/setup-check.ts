import { createLiveSetupVerifier } from "@/lib/setup/live";
import {
  formatSetupReport,
  runSetupVerification,
} from "@/lib/setup/verification";

const report = await runSetupVerification(
  process.env,
  createLiveSetupVerifier(process.env),
);

console.log(formatSetupReport(report));
process.exitCode = report.exitCode;
