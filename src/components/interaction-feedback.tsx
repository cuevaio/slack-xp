"use client";

import { useEffect } from "react";

const clickSources = {
  press: "/click-press.wav",
  release: "/click-release.wav",
} as const;

type ClickPhase = keyof typeof clickSources;

export function InteractionFeedback() {
  useEffect(() => {
    const pressedPointers = new Set<number>();
    const soundingPointers = new Set<number>();
    const audioPools: Record<ClickPhase, HTMLAudioElement[]> = {
      press: [],
      release: [],
    };
    const nextAudio = { press: 0, release: 0 };

    for (const phase of Object.keys(clickSources) as ClickPhase[]) {
      audioPools[phase] = Array.from({ length: 3 }, () => {
        const audio = new Audio(clickSources[phase]);
        audio.preload = "auto";
        audio.load();
        return audio;
      });
    }

    function playRetroClick(phase: ClickPhase) {
      const pool = audioPools[phase];
      const audio = pool[nextAudio[phase] % pool.length];
      nextAudio[phase] += 1;
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;

      pressedPointers.add(event.pointerId);
      document.documentElement.dataset.pointerPressed = "true";

      if (
        event.target instanceof Element &&
        event.target.closest("[data-sound-off]")
      ) {
        return;
      }

      soundingPointers.add(event.pointerId);
      playRetroClick("press");
    }

    function handlePointerUp(event: PointerEvent) {
      if (!pressedPointers.delete(event.pointerId)) return;
      if (pressedPointers.size === 0) {
        delete document.documentElement.dataset.pointerPressed;
      }
      if (soundingPointers.delete(event.pointerId)) {
        playRetroClick("release");
      }
    }

    function handlePointerCancel(event: PointerEvent) {
      pressedPointers.delete(event.pointerId);
      soundingPointers.delete(event.pointerId);
      if (pressedPointers.size === 0) {
        delete document.documentElement.dataset.pointerPressed;
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      delete document.documentElement.dataset.pointerPressed;
      for (const audio of Object.values(audioPools).flat()) audio.pause();
    };
  }, []);

  return null;
}
