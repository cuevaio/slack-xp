"use client";

import { useEffect } from "react";

function play(source: string, volume = 1) {
  const audio = new Audio(source);
  audio.volume = volume;
  void audio.play().catch(() => undefined);
}

function keyboardSound(event: KeyboardEvent, phase: "down" | "up") {
  if (event.key === "Enter") {
    return `/keyboard/enter-${phase === "down" ? "press" : "release"}.wav`;
  }
  const key = event.code || event.key;
  let hash = 0;
  for (const character of key)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const soundId = (hash % 54) + 1;
  return `/keyboard/crystal-purple/${soundId}-${phase}.wav`;
}

export function InteractionFeedback() {
  useEffect(() => {
    const pressedKeys = new Set<string>();
    const onPointerDown = () => play("/click-press.wav", 0.7);
    const onPointerUp = () => play("/click-release.wav", 0.7);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || pressedKeys.has(event.code)) return;
      pressedKeys.add(event.code);
      play(keyboardSound(event, "down"), 0.5);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code);
      play(keyboardSound(event, "up"), 0.5);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);
  return null;
}
