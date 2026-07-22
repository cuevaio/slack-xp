import { defineConfig } from "@portalsdk/config";

// Every current and future Office Channel, including hidden Office Event channels,
// must refuse Portal's anonymous credential. Clerk gating alone is not authorization.
export default defineConfig({
  channels: {
    "*": { anonymous: false },
  },
});
