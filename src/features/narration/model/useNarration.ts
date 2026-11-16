import { useState, useEffect, useRef } from "react";
import type { AudioState } from "../../../shared/types";
import { artworkById } from "../../../shared/catalog";
import { captionAt } from "../lib/timeline";
import { speak, stopSpeech } from "../lib/speech";
export function useNarration(onEnd: () => void) {
  const [state, setState] = useState<AudioState>({
    artworkId: null,
    elapsed: 0,
    playing: false,
    rate: 1,
  });
  const callback = useRef(onEnd);
  callback.current = onEnd;
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    if (!state.playing) return;
    let previous = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      setState((s) => ({ ...s, elapsed: s.elapsed + delta * s.rate }));
    }, 150);
    return () => clearInterval(t);
  }, [state.playing]);
  const a = artworkById(state.artworkId);
  const caption = a ? captionAt(a, state.elapsed) : "";
  useEffect(() => {
    if (state.playing && caption) setSupported(speak(caption, state.rate));
    else stopSpeech();
    return stopSpeech;
  }, [caption, state.playing, state.rate]);
  useEffect(() => {
    if (a && state.playing && state.elapsed >= a.duration) {
      setState((s) => ({ ...s, playing: false, elapsed: a.duration }));
      callback.current();
    }
  }, [state.elapsed, state.playing, a]);
  return {
    state,
    caption,
    supported,
    play: (id: string) =>
      setState((s) => ({
        ...s,
        artworkId: id,
        elapsed:
          s.artworkId === id && s.elapsed < (artworkById(id)?.duration || 0)
            ? s.elapsed
            : 0,
        playing: true,
      })),
    pause: () => setState((s) => ({ ...s, playing: false })),
    toggle: () => setState((s) => ({ ...s, playing: !s.playing })),
    seek: (elapsed: number) => setState((s) => ({ ...s, elapsed })),
    rate: (rate: number) => setState((s) => ({ ...s, rate })),
  };
}
