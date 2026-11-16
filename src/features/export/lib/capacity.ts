/**
 * 设备渲染容量探测。
 *
 * 高分辨率、显存限制与持续交互流畅度不可能同时无限满足：
 * 这里用一次性 WebGL 探针读取硬件上限，结合设备内存/核心数启发式
 * 给出明确的档位与分块尺寸，所有渲染都在该预算内分批进行。
 */

export type Capacity = {
  /** GL 最大纹理/渲染缓冲边长（像素） */
  maxTextureSize: number;
  /** 单块渲染缓冲边长（受限于 maxTextureSize 与内存预算） */
  tileSize: number;
  /** 估算的内存档位（粗粒度，仅用于档位限制） */
  memoryTier: "low" | "medium" | "high";
  /** 并发渲染块数上限，保证交互帧率 */
  concurrentTiles: number;
  /** 可用的全景档位（等距柱状宽度） */
  panoramaTiers: PanoramaTier[];
  /** 可用的海报档位（2D 总边长） */
  posterTiers: PosterTier[];
  /** 浏览器存储估算配额（字节），拿不到时为 null */
  storageQuota: number | null;
  /** 探针本身是否成功（失败时回退到最保守预算） */
  probed: boolean;
};

export type PanoramaTier = {
  id: string;
  label: string;
  width: number;
  height: number;
  faceSize: number;
  note: string;
};

export type PosterTier = {
  id: string;
  label: string;
  width: number;
  height: number;
  note: string;
};

const FALLBACK: Omit<Capacity, "posterTiers" | "panoramaTiers" | "tileSize"> = {
  maxTextureSize: 2048,
  memoryTier: "low",
  concurrentTiles: 1,
  storageQuota: null,
  probed: false,
};

/** 不抛错的容量探测：任何失败都回退到最保守预算，导出仍可在低档位完成 */
export function probeCapacity(): Capacity {
  try {
    const base = probeGL();
    const tier = detectMemoryTier();
    const tileSize = pickTileSize(base.maxTextureSize, tier);
    return {
      ...base,
      memoryTier: tier,
      tileSize,
      concurrentTiles: tier === "low" ? 1 : 2,
      panoramaTiers: panoramaTiersFor(base.maxTextureSize, tier, tileSize),
      posterTiers: posterTiersFor(base.maxTextureSize, tier),
      storageQuota: null,
    };
  } catch {
    // 非 DOM 环境或探测异常：使用最保守预算，保证功能不中断
    const tileSize = pickTileSize(FALLBACK.maxTextureSize, "low");
    return {
      ...FALLBACK,
      tileSize,
      panoramaTiers: panoramaTiersFor(FALLBACK.maxTextureSize, "low", tileSize),
      posterTiers: posterTiersFor(FALLBACK.maxTextureSize, "low"),
    };
  }
}

export async function estimateStorage(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & {
      storage?: { estimate?: () => Promise<{ quota?: number }> };
    };
    const e = await nav.storage?.estimate?.();
    return typeof e?.quota === "number" ? e.quota : null;
  } catch {
    return null;
  }
}

function probeGL(): Pick<Capacity, "maxTextureSize" | "probed" | "storageQuota"> {
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | null = null;
  try {
    canvas = document.createElement("canvas");
    gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return { ...FALLBACK };
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // 立即释放探针上下文，绝不长期占用一个 WebGL 句柄
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return {
      maxTextureSize: typeof max === "number" && max >= 512 ? max : 2048,
      probed: true,
      storageQuota: null,
    };
  } catch {
    return { ...FALLBACK };
  } finally {
    gl = null;
    canvas = null;
  }
}

function detectMemoryTier(): Capacity["memoryTier"] {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const mem = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  if (mem <= 2 || (mem <= 4 && cores <= 4)) return "low";
  if (mem >= 8 && cores >= 8) return "high";
  return "medium";
}

function pickTileSize(
  maxTextureSize: number,
  tier: Capacity["memoryTier"],
): number {
  // RGBA8 每像素 4 字节；单块预算：low 64MB、medium 128MB、high 256MB
  const budget =
    tier === "low" ? 64 * 1024 * 1024 : tier === "medium" ? 128 * 1024 * 1024 : 256 * 1024 * 1024;
  const byMemory = Math.floor(Math.sqrt(budget / 4));
  const raw = Math.min(maxTextureSize, byMemory, 2048);
  // 取 256 的整数倍，保证分块整齐
  return Math.max(256, Math.floor(raw / 256) * 256);
}

function panoramaTiersFor(
  maxTextureSize: number,
  tier: Capacity["memoryTier"],
  tileSize: number,
): PanoramaTier[] {
  const all: PanoramaTier[] = [
    {
      id: "uhd",
      label: "超清 8K 环视",
      width: 8192,
      height: 4096,
      faceSize: 2048,
      note: "8192×4096 等距柱状全景，约 4000 万像素，适合大屏与二次裁切",
    },
    {
      id: "hd",
      label: "高清 4K 环视",
      width: 4096,
      height: 2048,
      faceSize: 1024,
      note: "4096×2048 等距柱状全景，兼容主流全景查看器",
    },
    {
      id: "sd",
      label: "标清 2K 环视",
      width: 2048,
      height: 1024,
      faceSize: 512,
      note: "2048×1024，显存占用最小的环视档",
    },
  ];
  return all.filter((t) => {
    // 立方体面必须能在 GL 上限与分块预算内完成
    if (t.faceSize > maxTextureSize) return false;
    if (t.faceSize > tileSize && tileSize < 512) return false;
    if (t.id === "uhd" && tier === "low") return false;
    return true;
  });
}

function posterTiersFor(
  maxTextureSize: number,
  tier: Capacity["memoryTier"],
): PosterTier[] {
  const all: PosterTier[] = [
    {
      id: "a4-300",
      label: "超清海报 A4 · 300DPI",
      width: 2480,
      height: 3508,
      note: "A4 打印精度，含作品说明与收藏注记",
    },
    {
      id: "a4-200",
      label: "高清海报 A4 · 200DPI",
      width: 1654,
      height: 2339,
      note: "屏幕分享与普通打印兼顾",
    },
    {
      id: "a4-150",
      label: "标清海报 A4 · 150DPI",
      width: 1240,
      height: 1754,
      note: "导出最快，适合移动设备",
    },
  ];
  // iOS Safari 单 canvas 面积上限约 16777216 像素；低端机收紧
  const areaLimit = tier === "low" ? 4096 * 4096 : 16777216;
  return all.filter((t) => {
    if (t.width > maxTextureSize || t.height > maxTextureSize) return false;
    if (t.width * t.height > areaLimit) return false;
    if (t.id === "a4-300" && tier === "low") return false;
    return true;
  });
}

/** 估算一次导出峰值临时内存（字节），用于在 UI 明确展示限制 */
export function estimatePeakBytes(
  kind: "panorama" | "poster",
  width: number,
  height: number,
): number {
  if (kind === "panorama") {
    // 输出缓冲 + 单块渲染缓冲（tile RGBA8）
    return width * height * 4 + 1024 * 1024 * 4 * 32;
  }
  // 海报：2D 合成画布 + 单块 3D 渲染缓冲
  return width * height * 4 * 2 + 1024 * 1024 * 4 * 16;
}
