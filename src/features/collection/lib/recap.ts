import type { GalleryDocument } from "../../../shared/types";
import { artworkById } from "../../../shared/catalog";
export function recapStats(d: GalleryDocument) {
  return {
    seen: d.visits.filter((v) => v.seconds >= 2).length,
    seconds: Math.round(d.visits.reduce((n, v) => n + v.seconds, 0)),
    saved: d.favorites.length,
  };
}
export function createRecap(d: GalleryDocument): string {
  const stats = recapStats(d);
  return [
    "余境 · 我的参观回顾",
    `观看 ${stats.seen} 件作品 · 停留 ${stats.seconds} 秒`,
    "",
    ...d.favorites.map((id) => {
      const a = artworkById(id);
      return a
        ? `${a.title} / ${a.artist}
${d.notes[id] || "未添加感想"}
停留 ${Math.round(d.visits.find((v) => v.id === id)?.seconds || 0)} 秒`
        : "";
    }),
  ].join("\n\n");
}
