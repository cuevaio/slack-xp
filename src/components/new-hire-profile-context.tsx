"use client";

import Image from "next/image";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ProfileHRReportControls } from "@/components/message-hr-report-controls";
import { SendHomeControl } from "@/components/send-home-control";
import { TerminationControl } from "@/components/termination-control";
import { parseHRReportReviewTarget } from "@/lib/hr-reports/domain";
import { useProfileBatch } from "@/lib/profiles/client";
import type { ProfileAttribution } from "@/lib/profiles/types";
import { useSafetyProjectionStatus } from "@/lib/safety/client";

function ProfileContextContent({
  isError,
  isPending,
  profile,
  profileId,
  canSendHome,
}: {
  isError: boolean;
  isPending: boolean;
  profile: ProfileAttribution | undefined;
  profileId: string;
  canSendHome: boolean;
}) {
  if (isError) {
    return (
      <div className="portal-outage" role="alert">
        <strong>Profile unavailable.</strong>
        <span>Please try again later.</span>
      </div>
    );
  }

  if (isPending) {
    return <p aria-live="polite">Loading profile…</p>;
  }

  const current = profile?.status === "current";
  const displayName = current ? profile.displayName : "Former Employee";

  return (
    <>
      <div className="profile-context-identity">
        {current && profile.imageUrl ? (
          <Image
            alt={`${displayName}'s current profile`}
            height={88}
            src={profile.imageUrl}
            unoptimized
            width={88}
          />
        ) : (
          <span aria-hidden="true" className="profile-context-avatar">
            {displayName.slice(0, 1)}
          </span>
        )}
        <div>
          <h3>{displayName}</h3>
        </div>
      </div>
      {current ? (
        <>
          <ProfileHRReportControls profileId={profileId} />
          {canSendHome ? <SendHomeControl targetNewHireId={profileId} /> : null}
          {canSendHome ? (
            <TerminationControl
              allowReinstatement
              targetNewHireId={profileId}
            />
          ) : null}
        </>
      ) : (
        <p>This profile is no longer available.</p>
      )}
    </>
  );
}

export function NewHireProfileContext({
  canSendHome,
}: {
  canSendHome: boolean;
}) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const query = useProfileBatch(profileId ? [profileId] : []);
  const safetyStatus = useSafetyProjectionStatus(query);
  const profile = query.data?.find(
    (candidate) => candidate.clerkUserId === profileId,
  );

  useEffect(() => {
    const target = parseHRReportReviewTarget(window.location.search);
    setProfileId(target?.subjectType === "profile" ? target.profileId : null);
  }, []);

  useEffect(() => {
    if (profileId) closeButtonRef.current?.focus();
  }, [profileId]);

  function close(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete("profile");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setProfileId(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled])",
      ),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!profileId) return null;

  return (
    <div className="profile-context-backdrop">
      <section
        aria-labelledby="new-hire-profile-context-title"
        aria-modal="true"
        className="profile-context-dialog"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <header className="window-titlebar">
          <span>New Hire Profile</span>
          <button
            aria-label="Close New Hire Profile"
            onClick={close}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="profile-context-content">
          <h2 className="sr-only" id="new-hire-profile-context-title">
            New Hire Profile
          </h2>
          <ProfileContextContent
            isError={safetyStatus === "unavailable"}
            isPending={safetyStatus === "loading"}
            profile={profile}
            profileId={profileId}
            canSendHome={canSendHome}
          />
        </div>
      </section>
    </div>
  );
}
