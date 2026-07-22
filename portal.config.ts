import { defineConfig } from "@portalsdk/config";

// Every channel family created by the application must refuse Portal's anonymous
// credential. Clerk gating alone is not authorization.
export default defineConfig({
  channels: {
    "general:*": { anonymous: false },
    "watercooler:*": { anonymous: false },
    "tech-support:*": { anonymous: false },
    "urgent:*": { anonymous: false },
    "all-hands:*": { anonymous: false, mode: "broadcast" },
    "office-events:*": { anonymous: false },
    "hr-reports": { anonymous: false },
  },
});
