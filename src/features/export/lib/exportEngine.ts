import type { Capacity, PanoramaTier, PosterTier } from "./capacity";
import type { ExportKind, ExportSnapshot } from "./snapshot";
import {
  ExportCancelledError,
  ExportContextLostError,
  ExportFailedError,
  RenderSession,
  type AbortToken,
} from "./renderSession";
import { renderPanorama, type RenderProgress } from "./panorama";
import { renderPoster } from "./poster";

// 错误类型作为导出引擎公共 API 的一部分转出，便于调用方按类型处理
export {
  ExportCancelledError,
  ExportContextLostError,
  ExportFailedError,
} from "./renderSession";

export type JobStatus =
  | "queued"
  | "rendering"
  | "encoding"
  | "done"
  | "cancelled"
  | "failed";

export type ExportFormat = "png" | "jpeg";

export type ExportJob = {
  id: string;
  generation: number;
  exhibitionId: string;
  kind: ExportKind;
  format: ExportFormat;
  tierLabel: string;
  status: JobStatus;
  /** 0~1 总进度 */
  progress: number;
  stage: string;
  error: string | null;
  /** 完成后的对象 URL（由会话统一在任务移除/页面卸载时回收） */
  url: string | null;
  bytes: number;
  fileName: string;
  snapshotId: string;
  createdAt: number;
};

type InternalJob = ExportJob & {
  token: AbortToken;
  session: RenderSession | null;
  urlRevoked: boolean;
};

/** 渲染会话工厂：生产环境由 RenderSession.create 提供，测试可注入假实现 */
export type SessionFactory = (abort: AbortToken) => RenderSession;

/**
 * 导出任务会话：
 * - 全局串行（queued 队列），同一时刻只占一个离屏 WebGL 上下文，
 *   保证交互流畅度与显存预算可预测；
 * - generation 单调递增，切展览/取消重开时旧任务的任何回调都会被丢弃，
 *   旧结果绝不覆盖新任务；
 * - 取消、失败、上下文丢失都会释放渲染器与临时画布，失败不触碰
 *   实时展厅场景、讲解进度与 localStorage 中的回顾注记。
 */
export class ExportEngine {
  private jobs = new Map<string, InternalJob>();
  private queue: string[] = [];
  private running = false;
  private generation = 0;
  private listeners = new Set<() => void>();
  private capacity: Capacity;
  private createSession: SessionFactory;

  constructor(
    capacity: Capacity,
    createSession: SessionFactory = RenderSession.create,
  ) {
    this.capacity = capacity;
    this.createSession = createSession;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): ExportJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ token: _token, session: _session, urlRevoked: _u, ...pub }) => pub);
  }

  /** 仅供测试/校验读取已完成任务的对象 URL，不改变任务状态 */
  resultUrl(id: string): string | null {
    return this.jobs.get(id)?.url ?? null;
  }

  /** 切换展览：让所有旧世代任务作废并释放资源，新结果只属于新展览 */
  resetForExhibition(exhibitionId: string) {
    this.generation += 1;
    for (const job of this.jobs.values()) {
      if (job.exhibitionId !== exhibitionId) {
        this.cancelJob(job.id, "展览已切换");
      }
    }
  }

  enqueue(
    snapshot: ExportSnapshot,
    opts: {
      kind: ExportKind;
      format: ExportFormat;
      tier: PanoramaTier | PosterTier;
    },
  ): string {
    this.generation += 1;
    const job: InternalJob = {
      id: `job-${this.generation}-${snapshot.id.slice(-6)}`,
      generation: this.generation,
      exhibitionId: snapshot.exhibitionId,
      kind: opts.kind,
      format: opts.format,
      tierLabel: opts.tier.label,
      status: "queued",
      progress: 0,
      stage: "排队等待渲染",
      error: null,
      url: null,
      bytes: 0,
      fileName: buildFileName(snapshot, opts.kind, opts.format),
      snapshotId: snapshot.id,
      createdAt: Date.now(),
      token: {
        cancelled: false,
        reason: null,
        throwIfCancelled() {
          if (this.cancelled)
            throw new ExportCancelledError(this.reason ?? "cancelled");
        },
      },
      session: null,
      urlRevoked: false,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.emit();
    void this.pump();
    return job.id;
  }

  cancel(id: string, reason = "用户取消") {
    this.cancelJob(id, reason);
  }

  private cancelJob(id: string, reason: string) {
    const job = this.jobs.get(id);
    if (!job || ["done", "cancelled", "failed"].includes(job.status)) return;
    job.token.cancelled = true;
    job.token.reason = reason;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.stage = reason;
      job.progress = 0;
      this.queue = this.queue.filter((q) => q !== id);
    } else {
      job.stage = `正在取消：${reason}`;
    }
    this.emit();
  }

  /** 移除任务条目并回收对象 URL；已完成的下载文件不受影响 */
  remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.url && !job.urlRevoked) {
      URL.revokeObjectURL(job.url);
      job.urlRevoked = true;
    }
    this.jobs.delete(id);
    this.queue = this.queue.filter((q) => q !== id);
    this.emit();
  }

  dispose() {
    for (const id of [...this.jobs.keys()]) this.cancelJob(id, "页面卸载");
    for (const job of this.jobs.values()) {
      if (job.url && !job.urlRevoked) {
        URL.revokeObjectURL(job.url);
        job.urlRevoked = true;
      }
      job.session?.dispose();
    }
    this.jobs.clear();
    this.queue = [];
    this.listeners.clear();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const job = this.jobs.get(id);
        if (!job) continue;
        if (job.status === "cancelled") continue;
        await this.run(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(job: InternalJob) {
    // 取消令牌是唯一的失效信号：用户取消、切展览、页面卸载都会置位；
    // 新任务有独立令牌与独立快照，因此旧任务永远无法写入新任务的结果。
    const stale = () => job.token.cancelled;
    const snapshot = this.snapshotFor(job);
    if (!snapshot) {
      this.fail(job, "导出快照已失效，请按当前状态重新生成");
      return;
    }
    let session: RenderSession | null = null;
    try {
      job.status = "rendering";
      job.stage = "创建离屏渲染器";
      this.emit();
      session = this.createSession(job.token);
      job.session = session;
      if (stale()) throw new ExportCancelledError(job.token.reason ?? "cancelled");

      const onProgress: RenderProgress = (fraction, label) => {
        if (stale()) return;
        job.progress = Math.max(job.progress, Math.min(0.96, fraction * 0.96));
        job.stage = label;
        this.emit();
      };

      const tier = this.tierFor(job);
      const canvas =
        job.kind === "panorama"
          ? await renderPanorama(
              session,
              snapshot,
              tier as PanoramaTier,
              this.capacity.tileSize,
              job.token,
              onProgress,
            )
          : await renderPoster(
              session,
              snapshot,
              tier as PosterTier,
              this.capacity.tileSize,
              job.token,
              onProgress,
            );

      if (stale()) throw new ExportCancelledError(job.token.reason ?? "cancelled");
      job.status = "encoding";
      job.stage = "编码图像文件";
      job.progress = 0.97;
      this.emit();

      const mime = job.format === "jpeg" ? "image/jpeg" : "image/png";
      const blob = await canvas.convertToBlob({
        type: mime,
        quality: job.format === "jpeg" ? 0.92 : undefined,
      });
      // 离屏画布属于临时资源，编码完成后即可被 GC 回收
      canvas.width = 0;
      canvas.height = 0;

      if (stale()) {
        // 旧世代结果：blob 离开作用域即被 GC，绝不写入任务条目
        job.status = "cancelled";
        job.stage = job.token.reason ?? "已取消";
        this.emit();
        return;
      }
      job.url = URL.createObjectURL(blob);
      job.bytes = blob.size;
      job.status = "done";
      job.progress = 1;
      job.stage = "已完成，可下载";
      this.emit();
    } catch (err) {
      if (err instanceof ExportCancelledError || job.token.cancelled) {
        job.status = "cancelled";
        job.stage = job.token.reason ?? "已取消";
        this.emit();
      } else if (err instanceof ExportContextLostError) {
        this.fail(job, "浏览器回收了三维上下文，已停止本次导出，请重试");
      } else if (err instanceof ExportFailedError) {
        this.fail(job, err.message);
      } else {
        this.fail(
          job,
          `导出失败：${err instanceof Error ? err.message : "未知错误"}`,
        );
      }
    } finally {
      job.session = null;
      session?.dispose();
      this.emit();
    }
  }

  private fail(job: InternalJob, message: string) {
    job.status = "failed";
    job.error = message;
    job.stage = "导出失败";
    this.emit();
  }

  private snapshots = new Map<string, ExportSnapshot>();

  registerSnapshot(snapshot: ExportSnapshot) {
    this.snapshots.set(snapshot.id, snapshot);
  }

  private snapshotFor(job: InternalJob): ExportSnapshot | undefined {
    return this.snapshots.get(job.snapshotId);
  }

  private tierFor(job: InternalJob): PanoramaTier | PosterTier {
    const list =
      job.kind === "panorama"
        ? this.capacity.panoramaTiers
        : this.capacity.posterTiers;
    return (
      list.find((t) => t.label === job.tierLabel) ??
      list[list.length - 1]
    );
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

function buildFileName(
  snapshot: ExportSnapshot,
  kind: ExportKind,
  format: ExportFormat,
): string {
  const stamp = new Date(snapshot.createdAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  const prefix = kind === "panorama" ? "余境-环视全景" : "余境-纪念海报";
  return `${prefix}-${stamp}.${format === "jpeg" ? "jpg" : "png"}`;
}

export function downloadJob(job: ExportJob) {
  if (!job.url) return;
  const a = document.createElement("a");
  a.href = job.url;
  a.download = job.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
