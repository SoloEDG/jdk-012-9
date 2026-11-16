import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  estimateStorage,
  estimatePeakBytes,
  probeCapacity,
  type Capacity,
  type PanoramaTier,
  type PosterTier,
} from "../lib/capacity";
import {
  ExportEngine,
  downloadJob,
  type ExportFormat,
  type ExportJob,
} from "../lib/exportEngine";
import {
  createSnapshot,
  type ExportKind,
  type ExportSnapshot,
} from "../lib/snapshot";
import type {
  AudioState,
  GalleryDocument,
  Point,
  TourState,
} from "../../../shared/types";

export type SnapshotInputs = {
  exhibitionId: string;
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

export function useExport() {
  const capacity = useMemo<Capacity>(() => probeCapacity(), []);
  const engineRef = useRef<ExportEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ExportEngine(capacity);
  const engine = engineRef.current;

  const [jobs, setJobs] = useState<ExportJob[]>(() => engine.list());
  const [quota, setQuota] = useState<number | null>(null);

  // 便于端到端测试在真实页面里校验产物（仅挂载引用，不改变任何任务状态）
  useEffect(() => {
    (
      window as unknown as { __exportEngine?: ExportEngine }
    ).__exportEngine = engine;
    return () => {
      delete (window as unknown as { __exportEngine?: ExportEngine })
        .__exportEngine;
    };
  }, [engine]);

  useEffect(() => {
    const unsub = engine.subscribe(() => setJobs(engine.list()));
    void estimateStorage().then(setQuota);
    const onUnload = () => engine.dispose();
    window.addEventListener("pagehide", onUnload);
    return () => {
      unsub();
      window.removeEventListener("pagehide", onUnload);
      engine.dispose();
    };
  }, [engine]);

  /**
   * 按“此刻状态”冻结快照并入队。快照在入队瞬间生成，
   * 之后用户继续参观不影响该任务；需要最新画面时再次调用即可重新生成。
   */
  const start = useCallback(
    async (
      kind: ExportKind,
      format: ExportFormat,
      tier: PanoramaTier | PosterTier,
      inputs: SnapshotInputs,
    ): Promise<{ jobId: string; snapshot: ExportSnapshot }> => {
      // 等字体就绪，海报排版（含 Noto Serif SC）不会回退成默认字体
      try {
        await document.fonts?.ready;
      } catch {
        /* 字体不可用时使用 CSS 回退字体，不阻塞导出 */
      }
      const snapshot = createSnapshot({ kind, ...inputs });
      engine.registerSnapshot(snapshot);
      const jobId = engine.enqueue(snapshot, { kind, format, tier });
      return { jobId, snapshot };
    },
    [engine],
  );

  const cancel = useCallback(
    (id: string) => engine.cancel(id),
    [engine],
  );
  const remove = useCallback((id: string) => engine.remove(id), [engine]);
  const resetForExhibition = useCallback(
    (exhibitionId: string) => engine.resetForExhibition(exhibitionId),
    [engine],
  );

  return {
    capacity,
    jobs,
    quota,
    start,
    cancel,
    remove,
    download: downloadJob,
    resetForExhibition,
    estimateBytes: (kind: ExportKind, w: number, h: number) =>
      estimatePeakBytes(kind, w, h),
  };
}
