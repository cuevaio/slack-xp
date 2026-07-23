import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObserverTeaser } from "@/components/observer-teaser";
import { OfficeWindow } from "@/components/office-window";
import { ObserverMessageHistory, PortalChat } from "@/components/portal-chat";
import { listOfficeChannelsForDay } from "@/lib/portal/channels";

describe("Observer teaser", () => {
  test("opens read-only chats without sending observers to sign in", () => {
    const teaser = ObserverTeaser() as ReactElement<{
      children: ReactElement<{
        children?: ReactElement;
        signInHref?: string;
      }>;
    }>;
    const officeWindow = teaser.props.children;

    expect(officeWindow.type).toBe(OfficeWindow);
    expect(officeWindow.props.signInHref).toBeUndefined();
    expect(officeWindow.props.children?.type).toBe(PortalChat);
    expect(
      (officeWindow.props.children as ReactElement<{ mode: string }>).props
        .mode,
    ).toBe("observer");
  });

  test("groups consecutive messages without repeating sender metadata", () => {
    const markup = renderToStaticMarkup(
      <ObserverMessageHistory
        channel={listOfficeChannelsForDay("2025-07-22")[0]}
        messages={[
          {
            groupedWithPrevious: false,
            id: "message-1",
            sender: "New Hire",
            timestamp: 1_753_184_800_000,
            text: "First",
          },
          {
            groupedWithPrevious: true,
            id: "message-2",
            sender: "New Hire",
            timestamp: 1_753_184_860_000,
            text: "Second",
          },
          {
            groupedWithPrevious: false,
            id: "message-3",
            sender: "New Hire",
            timestamp: 1_753_185_400_000,
            text: "Later",
          },
        ]}
      />,
    );

    expect(markup.match(/message-avatar-placeholder/g)).toHaveLength(2);
    expect(markup.match(/chat-message-grouped/g)).toHaveLength(1);
  });

  test("shows sender metadata once for a complete message group", () => {
    const markup = renderToStaticMarkup(
      <ObserverMessageHistory
        channel={listOfficeChannelsForDay("2025-07-22")[0]}
        messages={Array.from({ length: 13 }, (_, index) => ({
          groupedWithPrevious: index > 0,
          id: `message-${index}`,
          sender: "New Hire",
          timestamp: 1_753_184_800_000 + index * 10_000,
          text: `Message ${index}`,
        }))}
      />,
    );

    expect(markup.match(/message-avatar-placeholder/g)).toHaveLength(1);
    expect(markup).toContain("Message 0");
  });
});
