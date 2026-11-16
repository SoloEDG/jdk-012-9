import type { Artwork } from "../../../shared/types";
export function captionAt(a: Artwork, elapsed: number): string {
  return a.transcript[
    Math.min(
      a.transcript.length - 1,
      Math.floor((elapsed / a.duration) * a.transcript.length),
    )
  ];
}
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
