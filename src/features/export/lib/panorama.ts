import type { ExportSnapshot } from "./snapshot";
import type { PanoramaTier } from "./capacity";
import {
  CUBE_FACES,
  RenderSession,
  planTiles,
  yieldToMain,
  type AbortToken,
  type CubeFace,
} from "./renderSession";

export type RenderProgress = (fraction: number, label: string) => void;

/**
 * 生成等距柱状（equirectangular）环视全景：
 * 1. 用独立离屏渲染器把冻结时刻的场景渲染到 6 个立方体面（按显存分块）；
 * 2. 在 CPU 侧把立方体投影装配成 2:1 全景，接缝固定在参观者身后，
 *    边界像素做钳制采样，杜绝黑缝、重复与缺失；
 * 3. 分带写回离屏画布，峰值内存 = 输出画布 + 6 个面缓冲 + 单块渲染缓冲。
 */
export async function renderPanorama(
  session: RenderSession,
  snapshot: ExportSnapshot,
  tier: PanoramaTier,
  tileSize: number,
  abort: AbortToken,
  onProgress: RenderProgress,
): Promise<OffscreenCanvas> {
  const { width: W, height: H, faceSize } = tier;
  const tiles = planTiles(faceSize, faceSize, tileSize);
  const totalUnits = CUBE_FACES.length * tiles.length + Math.ceil(H / BAND_ROWS);

  // 六个立方体面缓冲（GL 底行序），单块渲染缓冲只在渲染期间短暂存在
  const faces: Uint8Array[] = [];
  let done = 0;
  const clock = { n: 0, last: 0 };
  for (const face of CUBE_FACES) {
    abort.throwIfCancelled();
    const faceBuffer = new Uint8Array(faceSize * faceSize * 4);
    for (const t of tiles) {
      const tileBuffer = new Uint8Array(t.w * t.h * 4);
      await session.renderCubeTile({
        face,
        faceSize,
        tileX: t.x,
        tileY: t.y,
        tileW: t.w,
        tileH: t.h,
        target: tileBuffer,
        snapshot,
      });
      // 把分块拷入面缓冲：tile 坐标自底向上，与面缓冲行序一致
      for (let row = 0; row < t.h; row++) {
        faceBuffer.set(
          tileBuffer.subarray(row * t.w * 4, (row + 1) * t.w * 4),
          ((t.y + row) * faceSize + t.x) * 4,
        );
      }
      done += 1;
      onProgress(done / totalUnits, "渲染环视立方体面");
      await yieldToMain(clock, abort);
    }
    faces.push(faceBuffer);
  }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const band = ctx.createImageData(W, Math.min(BAND_ROWS, H));

  // 预计算行列方向表，内循环无三角函数，8K 装配也保持在可接受时长
  const sinTheta = new Float64Array(W);
  const cosTheta = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const theta = snapshot.yaw + (2 * Math.PI * x) / W - Math.PI;
    sinTheta[x] = Math.sin(theta);
    cosTheta[x] = Math.cos(theta);
  }
  const sinPhi = new Float64Array(H);
  const cosPhi = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    const phi = Math.PI / 2 - (Math.PI * y) / H;
    sinPhi[y] = Math.sin(phi);
    cosPhi[y] = Math.cos(phi);
  }

  for (let y0 = 0; y0 < H; y0 += BAND_ROWS) {
    abort.throwIfCancelled();
    const bandH = Math.min(BAND_ROWS, H - y0);
    for (let y = 0; y < bandH; y++) {
      const absY = y0 + y;
      const cp = cosPhi[absY];
      const sp = sinPhi[absY];
      for (let x = 0; x < W; x++) {
        // 近零分量归零：theta=±π 时 sin 的浮点残差（约 1e-16）会让环绕接缝
        // 两侧对几乎相同的点取整到相邻纹素，量化后首尾列采样完全一致
        const dx = quantizeZero(cp * sinTheta[x]);
        const dy = quantizeZero(sp);
        const dz = quantizeZero(cp * cosTheta[x]);
        const sample = sampleFace(faces, faceSize, dx, dy, dz);
        const src = (sample.py * faceSize + sample.px) * 4;
        const dst = (y * W + x) * 4;
        band.data[dst] = faces[sample.face][src];
        band.data[dst + 1] = faces[sample.face][src + 1];
        band.data[dst + 2] = faces[sample.face][src + 2];
        band.data[dst + 3] = 255;
      }
    }
    ctx.putImageData(band, 0, y0, 0, 0, W, bandH);
    done += 1;
    onProgress(done / totalUnits, "装配等距柱状全景");
    await yieldToMain(clock, abort);
  }

  // 面缓冲属于任务临时资源，装配完成后立即释放
  faces.length = 0;
  return canvas;
}

const BAND_ROWS = 128;

function pickFace(dx: number, dy: number, dz: number): CubeFace {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ax >= ay && ax >= az) return CUBE_FACES[dx > 0 ? 0 : 1];
  if (ay >= ax && ay >= az) return CUBE_FACES[dy > 0 ? 2 : 3];
  return CUBE_FACES[dz > 0 ? 4 : 5];
}

function sampleFace(
  faces: Uint8Array[],
  faceSize: number,
  dx: number,
  dy: number,
  dz: number,
): { face: number; px: number; py: number } {
  const face = pickFace(dx, dy, dz);
  const d = [dx, dy, dz];
  const normal = d[AXIS_INDEX[face.axis]] * face.sign;
  const sc = 1 / normal;
  const r = d[AXIS_INDEX[face.uAxis]] * face.uSign * sc;
  const b = d[AXIS_INDEX[face.vAxis]] * face.vSign * sc;
  // 钳制到 [-1,1]：相邻面共享边，接缝处不产生黑洞或重复采样
  const px = clamp01((r + 1) / 2) * (faceSize - 1);
  const pyBottom = clamp01((b + 1) / 2) * (faceSize - 1);
  return {
    face: face.id,
    px: Math.round(px),
    py: Math.round(pyBottom),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 浮点残差归零，保证环绕接缝两侧方向向量逐分量相同 */
function quantizeZero(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : v;
}

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };
