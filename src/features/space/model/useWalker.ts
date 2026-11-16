import { useState, useRef, useEffect } from "react";
import type { Point } from "../../../shared/types";
import { approach, constrain } from "../lib/motion";
export function useWalker(onPosition: (p: Point) => void) {
  const [position, setPosition] = useState<Point>({ x: 3, z: 6.5 });
  const positionRef = useRef(position);
  const target = useRef<Point | null>(null);
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const callback = useRef(onPosition);
  callback.current = onPosition;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
        ].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        keys.current.add(e.key.toLowerCase());
        target.current = null;
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      let p = positionRef.current;
      const k = keys.current;
      if (target.current) p = approach(p, target.current, dt);
      else {
        const f =
          Number(k.has("w") || k.has("arrowup")) -
          Number(k.has("s") || k.has("arrowdown"));
        const s =
          Number(k.has("d") || k.has("arrowright")) -
          Number(k.has("a") || k.has("arrowleft"));
        const length = Math.hypot(f, s) || 1;
        p = constrain({
          x:
            p.x +
            ((s * Math.cos(yaw.current) - f * Math.sin(yaw.current)) *
              dt *
              2.5) /
              length,
          z:
            p.z +
            ((-f * Math.cos(yaw.current) - s * Math.sin(yaw.current)) *
              dt *
              2.5) /
              length,
        });
      }
      if (
        Math.hypot(p.x - positionRef.current.x, p.z - positionRef.current.z) >
        0.0001
      ) {
        positionRef.current = p;
        setPosition(p);
        callback.current(p);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return {
    position,
    positionRef,
    yaw,
    go: (p: Point) => {
      target.current = p;
    },
    stop: () => {
      target.current = null;
    },
  };
}
