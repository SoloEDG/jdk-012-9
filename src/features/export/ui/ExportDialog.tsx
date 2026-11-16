import { useMemo, useState } from "react";
import {
  X,
  Camera,
  Globe,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Ban,
} from "lucide-react";
import type { Capacity } from "../lib/capacity";
import type { ExportJob } from "../lib/exportEngine";
import type { SnapshotInputs } from "../model/useExport";
import type { ExportKind, ExportSnapshot } from "../lib/snapshot";
import { artworkById } from "../../../shared/catalog";
import { formatTime } from "../../narration/lib/timeline";

type Tier = Capacity["panoramaTiers"][number] | Capacity["posterTiers"][number];

export function ExportDialog({
  open,
  onClose,
  capacity,
  jobs,
  quota,
  estimateBytes,
  onStart,
  onCancel,
  onRemove,
  onDownload,
  inputs,
}: {
  open: boolean;
  onClose: () => void;
  capacity: Capacity;
  jobs: ExportJob[];
  quota: number | null;
  estimateBytes: (kind: ExportKind, w: number, h: number) => number;
  onStart: (
    kind: ExportKind,
    format: "png" | "jpeg",
    tier: Tier,
    inputs: SnapshotInputs,
  ) => Promise<{ snapshot: ExportSnapshot }>;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (job: ExportJob) => void;
  inputs: SnapshotInputs;
}) {
  const [kind, setKind] = useState<ExportKind>("poster");
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [tierId, setTierId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const tiers =
    kind === "panorama" ? capacity.panoramaTiers : capacity.posterTiers;
  const selected =
    tiers.find((t) => t.id === tierId) ?? tiers[tiers.length - 1];
  const activeArtwork = artworkById(inputs.activeArtworkId);
  const activeJobs = jobs.slice(0, 6);

  const peak = useMemo(
    () => (selected ? estimateBytes(kind, selected.width, selected.height) : 0),
    [estimateBytes, kind, selected],
  );
  const overQuota = quota !== null && peak > quota * 0.25;

  if (!open) return null;

  const start = async () => {
    if (!selected) return;
    setBusy(true);
    setStartError(null);
    try {
      await onStart(kind, format, selected, inputs);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "无法开始导出");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-label="生成纪念影像"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="关闭"
          className="icon-button modal-close"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div className="eyebrow">KEEPSAKE RENDERING</div>
        <h2>把此刻，留成超清影像。</h2>

        <section className="export-snapshot">
          <div>
            <span className="eyebrow">冻结时刻</span>
            <p>
              {activeArtwork ? activeArtwork.title : "万物之间 · 主展厅"} ·
              机位 ({inputs.position.x.toFixed(1)},{" "}
              {inputs.position.z.toFixed(1)})
            </p>
            {inputs.narration.artworkId && (
              <small>
                讲解进度{" "}
                {formatTime(inputs.narration.elapsed)}
                {inputs.narration.playing ? " · 讲解中" : " · 已暂停"}
              </small>
            )}
          </div>
          <div>
            <span className="eyebrow">同框作品</span>
            <p>{visibleSummary(inputs)}</p>
          </div>
        </section>

        <div className="export-kind-switch" role="tablist">
          <button
            role="tab"
            aria-selected={kind === "poster"}
            className={kind === "poster" ? "active" : ""}
            onClick={() => setKind("poster")}
          >
            <Camera size={16} />
            平面海报
            <small>作品说明 · 讲解段落 · 收藏注记</small>
          </button>
          <button
            role="tab"
            aria-selected={kind === "panorama"}
            className={kind === "panorama" ? "active" : ""}
            onClick={() => setKind("panorama")}
          >
            <Globe size={16} />
            环视全景
            <small>360° 等距柱状 · 兼容全景查看器</small>
          </button>
        </div>

        <div className="export-tiers">
          {tiers.map((t) => (
            <label
              key={t.id}
              className={selected?.id === t.id ? "tier active" : "tier"}
            >
              <input
                type="radio"
                name="tier"
                value={t.id}
                checked={selected?.id === t.id}
                onChange={() => setTierId(t.id)}
              />
              <strong>{t.label}</strong>
              <small>
                {t.width}×{t.height}
              </small>
              <span>{t.note}</span>
            </label>
          ))}
        </div>

        <div className="export-format">
          <span>文件格式</span>
          <label className={format === "png" ? "active" : ""}>
            <input
              type="radio"
              name="format"
              checked={format === "png"}
              onChange={() => setFormat("png")}
            />
            PNG（无损，文件较大）
          </label>
          <label className={format === "jpeg" ? "active" : ""}>
            <input
              type="radio"
              name="format"
              checked={format === "jpeg"}
              onChange={() => setFormat("jpeg")}
            />
            JPG（92% 质量，体积更小）
          </label>
        </div>

        <div className="export-budget">
          <AlertTriangle size={14} />
          <span>
            分块边长上限 {capacity.tileSize}px · 单任务串行渲染 · 峰值临时内存约{" "}
            {formatMb(peak)}
            {overQuota && "，接近浏览器存储配额，建议改用 JPG 或较低档位"}
            {!capacity.probed && " · 未能完成硬件探测，已采用最保守预算"}
          </span>
        </div>

        {startError && <p className="export-error-text">{startError}</p>}

        <div className="export-actions">
          <button className="primary" onClick={start} disabled={busy || !selected}>
            {busy ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
            按当前状态生成
          </button>
          <p className="export-hint">
            生成期间可继续参观，画面以本次冻结时刻为准；需要最新画面时再次生成即可。
          </p>
        </div>

        {activeJobs.length > 0 && (
          <section className="export-jobs">
            <h3>导出任务</h3>
            {activeJobs.map((job) => (
              <ExportJobRow
                key={job.id}
                job={job}
                onCancel={onCancel}
                onRemove={onRemove}
                onDownload={onDownload}
                onRetry={start}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function ExportJobRow({
  job,
  onCancel,
  onRemove,
  onDownload,
  onRetry,
}: {
  job: ExportJob;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (job: ExportJob) => void;
  onRetry: () => void;
}) {
  const pct = Math.round(job.progress * 100);
  return (
    <article className={`export-job ${job.status}`}>
      <div className="export-job-head">
        <span className="export-job-title">
          {job.kind === "panorama" ? <Globe size={14} /> : <Camera size={14} />}
          {job.tierLabel} · {job.format.toUpperCase()}
        </span>
        <StatusBadge status={job.status} />
      </div>
      {(job.status === "rendering" ||
        job.status === "encoding" ||
        job.status === "queued") && (
        <>
          <div className="export-progress">
            <i style={{ width: `${pct}%` }} />
          </div>
          <small>
            {job.stage} · {pct}%
          </small>
          <button className="text-button" onClick={() => onCancel(job.id)}>
            <Ban size={13} /> 取消
          </button>
        </>
      )}
      {job.status === "done" && (
        <div className="export-job-done">
          <small>
            {formatBytes(job.bytes)} · {job.fileName}
          </small>
          <div>
            <button className="primary small" onClick={() => onDownload(job)}>
              <Download size={14} /> 下载
            </button>
            <button className="text-button" onClick={() => onRemove(job.id)}>
              <Trash2 size={13} /> 清除
            </button>
          </div>
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="export-job-done">
          <small>{job.stage}，临时资源已释放</small>
          <div>
            <button className="text-button" onClick={onRetry}>
              <RefreshCw size={13} /> 按当前状态重新生成
            </button>
            <button className="text-button" onClick={() => onRemove(job.id)}>
              <Trash2 size={13} /> 清除
            </button>
          </div>
        </div>
      )}
      {job.status === "failed" && (
        <div className="export-job-done">
          <small className="export-fail">{job.error}</small>
          <div>
            <button className="text-button" onClick={onRetry}>
              <RefreshCw size={13} /> 重试
            </button>
            <button className="text-button" onClick={() => onRemove(job.id)}>
              <Trash2 size={13} /> 清除
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: ExportJob["status"] }) {
  const map: Record<ExportJob["status"], { text: string; cls: string }> = {
    queued: { text: "排队中", cls: "queued" },
    rendering: { text: "渲染中", cls: "rendering" },
    encoding: { text: "编码中", cls: "encoding" },
    done: { text: "已完成", cls: "done" },
    cancelled: { text: "已取消", cls: "cancelled" },
    failed: { text: "失败", cls: "failed" },
  };
  const item = map[status];
  return (
    <span className={`export-status ${item.cls}`}>
      {status === "done" ? <CheckCircle2 size={12} /> : null}
      {item.text}
    </span>
  );
}

function visibleSummary(inputs: SnapshotInputs): string {
  if (inputs.activeArtworkId) {
    const a = artworkById(inputs.activeArtworkId);
    return a ? a.title : "当前视角";
  }
  return "自由视角";
}

function formatMb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
