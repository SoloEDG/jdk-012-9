import type { ExportSnapshot } from "./snapshot";
import type { PosterTier } from "./capacity";
import { artworkById } from "../../../shared/catalog";
import { formatTime } from "../../narration/lib/timeline";
import {
  RenderSession,
  planTiles,
  yieldToMain,
  type AbortToken,
} from "./renderSession";
import type { RenderProgress } from "./panorama";
import { snapshotCaption } from "./snapshot";

const IMAGE_RATIO = 0.62;
const INK = "#1c201c";
const PAPER = "#f3efe5";
const GOLD = "#b3925c";

/**
 * 生成带作品说明的平面海报：
 * 1. 上半部分是与实时画面同一镜头、同一时刻的三维渲染，
 *    用 setViewOffset 分块后逐像素恰好渲染一次，接缝/遮挡/透明物体无重复缺失；
 * 2. 下半部分在 2D 画布排版作品档案、讲解对应段落、同框作品与收藏注记；
 * 3. 分块与文字排版之间主动让出主线程，参观交互保持流畅。
 */
export async function renderPoster(
  session: RenderSession,
  snapshot: ExportSnapshot,
  tier: PosterTier,
  tileSize: number,
  abort: AbortToken,
  onProgress: RenderProgress,
): Promise<OffscreenCanvas> {
  const W = tier.width;
  const H = tier.height;
  const imageH = Math.round(H * IMAGE_RATIO);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  const tiles = planTiles(W, imageH, tileSize);
  const clock = { n: 0, last: 0 };
  for (const t of tiles) {
    abort.throwIfCancelled();
    const buffer = new Uint8Array(t.w * t.h * 4);
    await session.renderPerspectiveTile({
      fullW: W,
      fullH: imageH,
      tileX: t.x,
      tileY: t.y,
      tileW: t.w,
      tileH: t.h,
      target: buffer,
      snapshot,
    });
    // GL 行序自底向上，写入 2D 画布时逐行翻转
    const imageData = ctx.createImageData(t.w, t.h);
    for (let row = 0; row < t.h; row++) {
      const srcStart = row * t.w * 4;
      const dstRow = t.h - 1 - row;
      imageData.data.set(
        buffer.subarray(srcStart, srcStart + t.w * 4),
        dstRow * t.w * 4,
      );
    }
    ctx.putImageData(imageData, t.x, imageH - t.y - t.h);
    onProgress((tiles.indexOf(t) + 1) / (tiles.length + 1), "分块渲染海报画面");
    await yieldToMain(clock, abort);
  }

  composeInfoPanel(ctx, W, H, imageH, snapshot);
  onProgress(1, "合成作品说明与收藏注记");
  return canvas;
}

function composeInfoPanel(
  ctx: OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  imageH: number,
  snapshot: ExportSnapshot,
) {
  const pad = Math.round(W * 0.072);
  const panelTop = imageH + Math.round(H * 0.018);
  ctx.fillStyle = INK;
  ctx.fillRect(0, imageH, W, H - imageH);

  const a = artworkById(snapshot.activeArtworkId);
  let y = panelTop + pad * 0.7;

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = GOLD;
  ctx.font = `500 ${Math.round(W * 0.018)}px Inter, "PingFang SC", sans-serif`;
  ctx.fillText("YUJING ART SPACE · 纪念影像", pad, y);
  y += Math.round(W * 0.045);

  if (a) {
    const isFavorite = snapshot.favorites.includes(a.id);
    ctx.fillStyle = PAPER;
    ctx.font = `600 ${Math.round(W * 0.052)}px "Noto Serif SC", "PingFang SC", serif`;
    y = wrapText(ctx, a.title, pad, y, W - pad * 2, Math.round(W * 0.066));
    ctx.fillStyle = "#9a958a";
    ctx.font = `400 ${Math.round(W * 0.02)}px Inter, sans-serif`;
    ctx.fillText(a.en, pad, y);
    y += Math.round(W * 0.044);
    ctx.fillStyle = "#d8d3c6";
    ctx.font = `400 ${Math.round(W * 0.024)}px "PingFang SC", sans-serif`;
    ctx.fillText(`${a.artist} · ${a.year} · ${a.medium}`, pad, y);
    y += Math.round(W * 0.052);
    ctx.fillStyle = "#c4bfb2";
    ctx.font = `400 ${Math.round(W * 0.025)}px "PingFang SC", sans-serif`;
    y = wrapText(
      ctx,
      a.description,
      pad,
      y,
      W - pad * 2,
      Math.round(W * 0.038),
    );
    y += Math.round(W * 0.03);

    const caption = snapshotCaption(snapshot);
    if (caption) {
      y = sectionLabel(ctx, "讲解段落", pad, y, W);
      const n = snapshot.narration;
      if (n) {
        ctx.fillStyle = "#8d877b";
        ctx.font = `400 ${Math.round(W * 0.018)}px Inter, sans-serif`;
        ctx.fillText(
          `${n.playing ? "正在讲解" : "讲解进度"} · ${formatTime(n.elapsed)} / ${formatTime(a.duration)}`,
          pad,
          y,
        );
        y += Math.round(W * 0.032);
      }
      ctx.fillStyle = PAPER;
      ctx.font = `400 ${Math.round(W * 0.027)}px "Noto Serif SC", "PingFang SC", serif`;
      y = wrapText(
        ctx,
        `“${caption}”`,
        pad,
        y,
        W - pad * 2,
        Math.round(W * 0.042),
      );
      y += Math.round(W * 0.028);
    }

    if (snapshot.note) {
      y = sectionLabel(ctx, "我的收藏注记", pad, y, W);
      ctx.fillStyle = "#d8d3c6";
      ctx.font = `400 ${Math.round(W * 0.025)}px "PingFang SC", sans-serif`;
      y = wrapText(
        ctx,
        snapshot.note,
        pad,
        y,
        W - pad * 2,
        Math.round(W * 0.038),
      );
      y += Math.round(W * 0.024);
    }

    if (snapshot.visibleArtworkIds.length > 1) {
      const others = snapshot.visibleArtworkIds
        .filter((id) => id !== a.id)
        .map((id) => artworkById(id)?.title)
        .filter(Boolean)
        .join(" · ");
      y = sectionLabel(ctx, "同框作品", pad, y, W);
      ctx.fillStyle = "#bdb7aa";
      ctx.font = `400 ${Math.round(W * 0.023)}px "PingFang SC", sans-serif`;
      y = wrapText(ctx, others, pad, y, W - pad * 2, Math.round(W * 0.036));
      y += Math.round(W * 0.02);
    }

    if (isFavorite) {
      drawFavoriteBadge(ctx, W, pad, panelTop + pad * 0.7);
    }
  } else {
    ctx.fillStyle = PAPER;
    ctx.font = `500 ${Math.round(W * 0.036)}px "Noto Serif SC", serif`;
    ctx.fillText("万物之间 · 主展厅", pad, y);
  }

  // 页脚：展览、日期与冻结时刻的机位，证明导出与参观状态同源
  ctx.fillStyle = "#7d776c";
  ctx.font = `400 ${Math.round(W * 0.017)}px Inter, "PingFang SC", sans-serif`;
  const date = new Date(snapshot.createdAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  ctx.fillText(
    `余境虚拟艺术馆 · 展览 001 万物之间 · ${date} · 机位 (${snapshot.position.x.toFixed(1)}, ${snapshot.position.z.toFixed(1)})`,
    pad,
    H - pad * 0.85,
  );
}

function sectionLabel(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  W: number,
): number {
  ctx.fillStyle = GOLD;
  ctx.font = `500 ${Math.round(W * 0.019)}px Inter, "PingFang SC", sans-serif`;
  ctx.fillText(text, x, y);
  return y + Math.round(W * 0.038);
}

function drawFavoriteBadge(
  ctx: OffscreenCanvasRenderingContext2D,
  W: number,
  pad: number,
  top: number,
) {
  const size = Math.round(W * 0.03);
  const cx = W - pad - size / 2;
  ctx.save();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  // 简化心形路径
  const s = size / 14;
  ctx.translate(cx, top + size / 2);
  ctx.moveTo(0, 4 * s);
  ctx.bezierCurveTo(-7 * s, -2 * s, -3 * s, -7 * s, 0, -3 * s);
  ctx.bezierCurveTo(3 * s, -7 * s, 7 * s, -2 * s, 0, 4 * s);
  ctx.fill();
  ctx.restore();
}

/** 按字符断行（兼容中文与英文单词），返回下一段的 y 坐标 */
function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const paragraphs = text.split("\n");
  let cursor = y;
  for (const para of paragraphs) {
    let line = "";
    const chars = Array.from(para);
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cursor);
        cursor += lineHeight;
        line = ch === " " ? "" : ch;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
    }
  }
  return cursor;
}
