import { useState } from "react";
import type { TourState } from "../../../shared/types";
import { routes } from "../../../shared/catalog";
import { tourTarget, tourRoute } from "../lib/routeProgress";
const initial: TourState = { routeId: null, step: 0, phase: "idle" };
export function useTour() {
  const [state, setState] = useState<TourState>(initial);
  return {
    state,
    target: tourTarget(state),
    start: (id: string) => {
      if (routes.some((r) => r.id === id))
        setState({ routeId: id, step: 0, phase: "walking" });
    },
    arrive: () =>
      setState((t) =>
        t.phase === "walking" ? { ...t, phase: "listening" } : t,
      ),
    next: () =>
      setState((t) => {
        const r = tourRoute(t);
        if (!r) return t;
        return t.step + 1 >= r.stops.length
          ? { ...t, phase: "done" }
          : { ...t, step: t.step + 1, phase: "walking" };
      }),
    pause: () => setState((t) => ({ ...t, phase: "paused" })),
    resume: () => setState((t) => ({ ...t, phase: "walking" })),
    stop: () => setState(initial),
  };
}
