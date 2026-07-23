"use client";

import { useEffect } from "react";

const clickSources = {
  press: "/click-press.wav",
  release: "/click-release.wav",
} as const;

type ClickPhase = keyof typeof clickSources;

const crystalPurpleSoundIds = [
  ...Array.from({ length: 54 }, (_, index) => String(index + 1)),
  "56",
  "57",
  "58",
  "3640",
  "3675",
  "3676",
  "57416",
  "57419",
  "57421",
  "57424",
];

const regularKeyboardSoundSources = crystalPurpleSoundIds.map((soundId) => ({
  press: `/keyboard/crystal-purple/${soundId}-down.wav`,
  release: `/keyboard/crystal-purple/${soundId}-up.wav`,
}));

const mappedKeyboardCodes = [
  "Escape",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "Backquote",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "Minus",
  "Equal",
  "Backspace",
  "Tab",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyT",
  "KeyY",
  "KeyU",
  "KeyI",
  "KeyO",
  "KeyP",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "CapsLock",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyJ",
  "KeyK",
  "KeyL",
  "Semicolon",
  "Quote",
  "ShiftLeft",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyV",
  "KeyB",
  "KeyN",
  "KeyM",
  "Comma",
  "Period",
  "Slash",
];
const keyboardSoundIndexByCode = new Map(
  mappedKeyboardCodes.map((code, index) => [code, index]),
);

const keyboardSoundSources = [
  ...regularKeyboardSoundSources,
  {
    press: "/keyboard/enter-press.wav",
    release: "/keyboard/enter-release.wav",
  },
];
const enterSoundIndex = keyboardSoundSources.length - 1;

function getKeyboardSoundIndex(key: string) {
  const mappedSoundIndex = keyboardSoundIndexByCode.get(key);
  if (mappedSoundIndex !== undefined) return mappedSoundIndex;

  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }

  return hash % regularKeyboardSoundSources.length;
}

export function InteractionFeedback() {
  useEffect(() => {
    const pressedPointers = new Set<number>();
    const soundingPointers = new Set<number>();
    const pressedKeys = new Map<string, number>();
    const audioPools: Record<ClickPhase, HTMLAudioElement[]> = {
      press: [],
      release: [],
    };
    const keyboardAudioPools = new Map<string, HTMLAudioElement[]>();
    const nextAudio = { press: 0, release: 0 };
    const nextKeyboardAudio = new Map<string, number>();

    function createAudio(source: string, volume = 1) {
      const audio = new Audio(source);
      audio.preload = "auto";
      audio.volume = volume;
      audio.load();
      return audio;
    }

    for (const phase of Object.keys(clickSources) as ClickPhase[]) {
      audioPools[phase] = Array.from({ length: 3 }, () =>
        createAudio(clickSources[phase]),
      );
    }

    function playRetroClick(phase: ClickPhase) {
      const pool = audioPools[phase];
      const audio = pool[nextAudio[phase] % pool.length];
      nextAudio[phase] += 1;
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    }

    function playKeyboardSound(phase: ClickPhase, soundIndex: number) {
      const source = keyboardSoundSources[soundIndex][phase];
      let pool = keyboardAudioPools.get(source);
      if (!pool) {
        pool = Array.from({ length: 2 }, () => createAudio(source, 0.55));
        keyboardAudioPools.set(source, pool);
      }

      const nextIndex = nextKeyboardAudio.get(source) ?? 0;
      const audio = pool[nextIndex % pool.length];
      nextKeyboardAudio.set(source, nextIndex + 1);
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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;

      const key = event.code || event.key;
      if (pressedKeys.has(key)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-sound-off]")
      ) {
        return;
      }

      const soundIndex =
        event.key === "Enter" ? enterSoundIndex : getKeyboardSoundIndex(key);
      pressedKeys.set(key, soundIndex);
      playKeyboardSound("press", soundIndex);
    }

    function handleKeyUp(event: KeyboardEvent) {
      const key = event.code || event.key;
      const soundIndex = pressedKeys.get(key);
      if (soundIndex === undefined) return;

      pressedKeys.delete(key);
      playKeyboardSound("release", soundIndex);
    }

    function handleWindowBlur() {
      for (const soundIndex of pressedKeys.values()) {
        playKeyboardSound("release", soundIndex);
      }
      pressedKeys.clear();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      delete document.documentElement.dataset.pointerPressed;
      for (const audio of Object.values(audioPools).flat()) audio.pause();
      for (const audio of [...keyboardAudioPools.values()].flat()) {
        audio.pause();
      }
    };
  }, []);

  return null;
}
