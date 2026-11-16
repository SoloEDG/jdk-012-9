import * as THREE from "three";
import type {
  AudioState,
  GalleryDocument,
  Point,
  TourState,
} from "../../../shared/types";
import { artworks, artworkById } from "../../../shared/catalog";
import { captionAt } from "../../narration/lib/timeline";

export type ExportKind = "panorama" | "poster";

/**
 * 导出快照：在用户点击生成的“同一时刻”冻结的全部状态。
 * 渲染期间用户继续参观只会改变实时场景，不会改动快照内容，
 * 因此后台导出始终完成最初选择的画面。
 */
export type ExportSnapshot = {
  id: string;
  exhibitionId: string;
  createdAt: number;
  kind: ExportKind;
  /** 镜头 */
  position: Point;
  yaw: number;
  pitch: number;
  fov: number;
  sculptureRotation: number;
  /** 作品状态 */
  activeArtworkId: string | null;
  nearbyArtworkId: string | null;
  visibleArtworkIds: string[];
  /** 讲解对应段落（冻结时刻的字幕与播放进度） */
  narration: {
    artworkId: string | null;
    elapsed: number;
    playing: boolean;
    rate: number;
    caption: string | null;
  } | null;
  /** 收藏注记（冻结时刻的副本） */
  favorites: string[];
  note: string | null;
  /** 导览进度 */
  tour: {
    routeId: string | null;
    step: number;
    phase: TourState["phase"];
  } | null;
};

export type SnapshotSource = {
  exhibitionId: string;
  kind: ExportKind;
  position: Point;
  yaw: number;
  pitch: number;
  fov: number;
  sculptureRotation: number;
  activeArtworkId: string | null;
  nearbyArtworkId: string | null;
  narration: AudioState;
  narrationCaption: string;
  document: GalleryDocument;
  tour: TourState;
};

export function createSnapshot(s: SnapshotSource): ExportSnapshot {
  const active = artworkById(s.activeArtworkId);
  const narrating = s.narration.artworkId && s.narration.playing;
  const narration = narrating
    ? {
        artworkId: s.narration.artworkId,
        elapsed: s.narration.elapsed,
        playing: s.narration.playing,
        rate: s.narration.rate,
        caption: s.narrationCaption || null,
      }
    : s.narration.artworkId
      ? {
          artworkId: s.narration.artworkId,
          elapsed: s.narration.elapsed,
          playing: false,
          rate: s.narration.rate,
          caption: null,
        }
      : null;
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exhibitionId: s.exhibitionId,
    createdAt: Date.now(),
    kind: s.kind,
    position: { ...s.position },
    yaw: s.yaw,
    pitch: s.pitch,
    fov: s.fov,
    sculptureRotation: s.sculptureRotation,
    activeArtworkId: s.activeArtworkId,
    nearbyArtworkId: s.nearbyArtworkId,
    visibleArtworkIds: computeVisibleArtworks(s.position, s.yaw, s.pitch, s.fov),
    narration,
    favorites: [...s.document.favorites],
    note: active ? (s.document.notes[active.id] ?? null) : null,
    tour: s.tour.routeId ? { ...s.tour } : null,
  };
}

/**
 * 纯数学计算快照时刻视锥内可见的作品，不依赖 WebGL 上下文，
 * 用于海报“同框作品”说明与导出前的状态确认。
 */
export function computeVisibleArtworks(
  position: Point,
  yaw: number,
  pitch: number,
  fov: number,
): string[] {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 80);
  camera.position.set(position.x, 1.7, position.z);
  camera.rotation.set(pitch, yaw, 0);
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
  const out: string[] = [];
  for (const a of artworks) {
    const point = new THREE.Vector3(a.position.x, 2.45, a.position.z);
    if (frustum.containsPoint(point)) out.push(a.id);
  }
  return out;
}

/** 快照时刻讲解对应的字幕段落（重新生成时复用同一进度） */
export function snapshotCaption(snap: ExportSnapshot): string | null {
  if (!snap.narration?.artworkId) return null;
  const a = artworkById(snap.narration.artworkId);
  if (!a) return null;
  return snap.narration.caption ?? captionAt(a, snap.narration.elapsed);
}
