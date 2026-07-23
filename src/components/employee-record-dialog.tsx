"use client";

import { useClerk } from "@clerk/nextjs";
import { ChevronUp, LogOut, Pencil } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { EmployeeRecordEditor } from "@/components/employee-record-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";

export function EmployeeRecordDialog({
  onboarding,
}: {
  onboarding: OnboardingSnapshot;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const { signOut } = useClerk();

  function openDialog() {
    setSaved(false);
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function handleClose() {
    if (saved) router.refresh();
    triggerRef.current?.focus();
  }

  function handleProjected() {
    setSaved(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              className="employee-record-trigger"
              ref={triggerRef}
              type="button"
            />
          }
        >
          {onboarding.imageUrl ? (
            <Image
              alt=""
              className="employee-record-avatar"
              height={36}
              src={onboarding.imageUrl}
              unoptimized
              width={36}
            />
          ) : (
            <span
              aria-hidden="true"
              className="employee-record-avatar-fallback"
            >
              {onboarding.displayName.slice(0, 1)}
            </span>
          )}
          <span className="employee-record-name">{onboarding.displayName}</span>
          <ChevronUp aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="employee-record-menu"
          side="top"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={openDialog}>
              <Pencil />
              Edit profile
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => void signOut({ redirectUrl: "/" })}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <dialog
        aria-labelledby="employee-record-dialog-title"
        className="employee-record-dialog"
        onClose={handleClose}
        ref={dialogRef}
      >
        <header className="window-titlebar">
          <span>Edit profile</span>
          <Button
            aria-label="Close profile editor"
            onClick={closeDialog}
            size="icon-sm"
            type="button"
          >
            ×
          </Button>
        </header>
        <div className="employee-record-dialog-body">
          <EmployeeRecordEditor
            headingId="employee-record-dialog-title"
            initialRecord={onboarding}
            onProjected={handleProjected}
          />
          {saved ? (
            <Button onClick={closeDialog} type="button">
              Done
            </Button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
