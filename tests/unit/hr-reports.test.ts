import { describe, expect, test } from "bun:test";
import {
  createHRReportDeepLink,
  HR_REPORT_CATEGORIES,
  PROFILE_HR_REPORT_CATEGORIES,
  parseHRReportReviewTarget,
  parseMessageHRReportRequest,
  parseProfileHRReportRequest,
} from "@/lib/hr-reports/domain";

describe("message HR Report contract", () => {
  test("accepts only approved private categories and current Office Channel references", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");

    for (const category of HR_REPORT_CATEGORIES) {
      expect(
        parseMessageHRReportRequest(
          {
            category,
            officeChannelId: "general:2026-07-22",
            messageId: "message-17",
          },
          now,
        ),
      ).toEqual({
        category,
        officeDay: "2026-07-22",
        officeChannelId: "general:2026-07-22",
        messageId: "message-17",
      });
    }

    expect(
      parseMessageHRReportRequest(
        {
          category: "other",
          officeChannelId: "general:2026-07-22",
          messageId: "message-17",
        },
        now,
      ),
    ).toBeNull();
    expect(
      parseMessageHRReportRequest(
        {
          category: HR_REPORT_CATEGORIES[0],
          officeChannelId: "general:2026-07-21",
          messageId: "message-17",
        },
        now,
      ),
    ).toBeNull();
    expect(
      parseMessageHRReportRequest(
        {
          category: HR_REPORT_CATEGORIES[0],
          officeChannelId: "made-up:2026-07-22",
          messageId: "message-17",
        },
        now,
      ),
    ).toBeNull();
  });

  test("builds and parses a same-origin review deep link without private report details", () => {
    const href = createHRReportDeepLink("https://office.example.com", {
      officeDay: "2026-07-22",
      officeChannelId: "urgent:2026-07-22",
      messageId: "message-urgent-17",
    });

    expect(href).toBe(
      "https://office.example.com/office?officeDay=2026-07-22&channel=urgent&message=message-urgent-17",
    );
    expect(parseHRReportReviewTarget(new URL(href).search)).toEqual({
      subjectType: "message",
      officeDay: "2026-07-22",
      officeChannelId: "urgent:2026-07-22",
      messageId: "message-urgent-17",
    });
    expect(href).not.toMatch(/category|reporter|harassment/i);
    expect(
      parseHRReportReviewTarget(
        "?officeDay=2026-07-22&channel=unknown&message=message-17",
      ),
    ).toBeNull();

    const versionedHref = createHRReportDeepLink("https://office.example.com", {
      officeDay: "2026-07-23",
      officeChannelId: "urgent:v2:2026-07-23",
      messageId: "message-versioned-18",
    });
    expect(versionedHref).toContain("channelGeneration=v2");
    expect(parseHRReportReviewTarget(new URL(versionedHref).search)).toEqual({
      subjectType: "message",
      officeDay: "2026-07-23",
      officeChannelId: "urgent:v2:2026-07-23",
      messageId: "message-versioned-18",
    });

    const legacyRolloverHref = createHRReportDeepLink(
      "https://office.example.com",
      {
        officeDay: "2026-07-23",
        officeChannelId: "urgent:2026-07-23",
        messageId: "message-legacy-19",
      },
    );
    expect(legacyRolloverHref).not.toContain("channelGeneration");
    expect(
      parseHRReportReviewTarget(new URL(legacyRolloverHref).search),
    ).toEqual({
      subjectType: "message",
      officeDay: "2026-07-23",
      officeChannelId: "urgent:2026-07-23",
      messageId: "message-legacy-19",
    });
  });

  test("accepts only approved New Hire Profile categories and stable identities", () => {
    for (const category of PROFILE_HR_REPORT_CATEGORIES) {
      expect(
        parseProfileHRReportRequest({
          subjectType: "profile",
          category,
          profileId: "user_profile_subject",
        }),
      ).toEqual({
        subjectType: "profile",
        category,
        profileId: "user_profile_subject",
      });
    }

    expect(
      parseProfileHRReportRequest({
        subjectType: "profile",
        category: HR_REPORT_CATEGORIES[0],
        profileId: "user_profile_subject",
      }),
    ).toBeNull();
    expect(
      parseProfileHRReportRequest({
        subjectType: "profile",
        category: PROFILE_HR_REPORT_CATEGORIES[0],
        profileId: " mutable profile ",
      }),
    ).toBeNull();
  });

  test("builds a type-specific profile review link containing no mutable values", () => {
    const href = createHRReportDeepLink("https://office.example.com", {
      subjectType: "profile",
      profileId: "user_profile_subject",
    });

    expect(href).toBe(
      "https://office.example.com/office?profile=user_profile_subject",
    );
    expect(parseHRReportReviewTarget(new URL(href).search)).toEqual({
      subjectType: "profile",
      profileId: "user_profile_subject",
    });
    expect(href).not.toMatch(/category|reporter|displayName|imageUrl/i);
  });
});
