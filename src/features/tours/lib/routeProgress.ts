import { routes } from "../../../shared/catalog";
import type { TourState } from "../../../shared/types";
export function tourRoute(t: TourState) {
  return routes.find((r) => r.id === t.routeId);
}
export function tourTarget(t: TourState): string | null {
  return tourRoute(t)?.stops[t.step] || null;
}
export function tourProgress(t: TourState): number {
  const r = tourRoute(t);
  return r ? (t.phase === "done" ? 1 : t.step / r.stops.length) : 0;
}
