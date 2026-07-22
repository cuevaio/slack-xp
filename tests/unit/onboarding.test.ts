import { describe, expect, test } from "bun:test";
import { assignJobTitle, validateProfileInput } from "@/lib/onboarding/domain";

describe("New Hire onboarding domain", () => {
  test("assigns a deterministic absurd job title from the stable Clerk ID", () => {
    const first = assignJobTitle("user_stable_new_hire");

    expect(assignJobTitle("user_stable_new_hire")).toBe(first);
    expect(first.length).toBeGreaterThan(10);
  });

  test("validates required setup data before it reaches Clerk or Neon", () => {
    expect(() =>
      validateProfileInput({ firstName: "", lastName: "", image: null }),
    ).toThrow("first name");
    expect(() =>
      validateProfileInput({
        firstName: "A".repeat(81),
        lastName: "",
        image: null,
      }),
    ).toThrow("80 characters");
    expect(() =>
      validateProfileInput({
        firstName: "Pat\u200b",
        lastName: "Pending",
        image: null,
      }),
    ).toThrow("invisible formatting characters");
    expect(() =>
      validateProfileInput({
        firstName: "Pat",
        lastName: "Pending",
        image: new File(["not-an-image"], "notes.txt", {
          type: "text/plain",
        }),
      }),
    ).toThrow("PNG, JPEG, or WebP");
    expect(() =>
      validateProfileInput({
        firstName: "Pat",
        lastName: "Pending",
        image: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "huge.png", {
          type: "image/png",
        }),
      }),
    ).toThrow("2 MB or smaller");
  });
});
