import { defineConfig } from "@portalsdk/config";

// Every current and future Office Channel, including hidden Office Event channels,
// must refuse Portal's anonymous credential. Clerk gating alone is not authorization.
export default defineConfig({
  channels: {
    "*": { anonymous: false },
    // Portal selects the longest fixed-prefix template and does not merge entries,
    // so authentication must be repeated on the broadcast override.
    "all-hands:*": { anonymous: false, mode: "broadcast" },
  },
});
