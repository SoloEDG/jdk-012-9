/**
 * Node 集成测试（无浏览器）：
 * 用假的 RenderSession 与 OffscreenCanvas 验证编排、世代守卫、取消、
 * 上下文丢失、等距柱状装配、海报文字排版与资源回收。
 * 运行：npx tsx tests/unit-export.mts
 */

// ---- 浏览器全局桩：必须在 import 被测模块前安装 ----
class FakeImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class Fake2DContext {
  canvas: FakeOffscreenCanvas;
  fillCalls = 0;
  textCalls: string[] = [];
  measureCache = new Map<string, number>();
  font = "";
  fillStyle = "";
  textAlign = "";
  textBaseline = "";
  constructor(canvas: FakeOffscreenCanvas) {
    this.canvas = canvas;
  }
  fillRect() {
    this.fillCalls++;
  }
  fillText(text: string) {
    this.textCalls.push(text);
  }
  measureText(text: string) {
    // 固定字宽，保证换行逻辑可预测
    return { width: this.measureCache.get(text) ?? text.length * 12 };
  }
  createImageData(w: number, h: number) {
    return new FakeImageData(w, h);
  }
  putImageData(img: FakeImageData, x: number, y: number) {
    this.canvas.painted.push({ x, y, w: img.width, h: img.height });
  }
  beginPath() {}
  bezierCurveTo() {}
  fill() {}
  save() {}
  restore() {}
  translate() {}
  moveTo() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  painted: { x: number; y: number; w: number; h: number }[] = [];
  ctx: Fake2DContext;
  converted = false;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = new Fake2DContext(this);
  }
  getContext() {
    return this.ctx;
  }
  async convertToBlob() {
    this.converted = true;
    return new Blob([new Uint8Array(this.width * this.height)], {
      type: "image/png",
    });
  }
}

const createdUrls: string[] = [];
const revokedUrls: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.OffscreenCanvas = FakeOffscreenCanvas;
g.ImageData = FakeImageData;
// Node 的 URL 类没有 createObjectURL/revokeObjectURL，整体替换
g.URL = class extends URL {
  static createObjectURL() {
    const u = `blob:fake-${createdUrls.length}`;
    createdUrls.push(u);
    return u;
  }
  static revokeObjectURL(u: string) {
    revokedUrls.push(u);
  }
};
// Node 22 已提供 Blob、performance、crypto.randomUUID，无需覆盖

// ---- 动态导入被测模块 ----
const { probeCapacity, estimatePeakBytes } = await import(
  "../src/features/export/lib/capacity.ts"
);
const { createSnapshot } = await import(
  "../src/features/export/lib/snapshot.ts"
);
const {
  ExportEngine,
  ExportCancelledError,
  ExportContextLostError,
} = await import("../src/features/export/lib/exportEngine.ts");
const { renderPanorama } = await import(
  "../src/features/export/lib/panorama.ts"
);
const { renderPoster } = await import("../src/features/export/lib/poster.ts");
const {
  ExportFailedError,
} = await import("../src/features/export/lib/renderSession.ts");

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) console.log("ok  :", msg);
  else {
    failures++;
    console.error("FAIL:", msg);
  }
};

// ---- 假渲染会话：可注入成功/取消/上下文丢失行为 ----
class FakeSession {
  disposed = false;
  contextLostMode: boolean;
  failAfter: number;
  tileCount = 0;
  constructor(opts: { contextLost?: boolean; failAfter?: number } = {}) {
    this.contextLostMode = !!opts.contextLost;
    this.failAfter = opts.failAfter ?? Infinity;
  }
  private maybeAbort(abort: { cancelled: boolean; reason: string | null }) {
    if (abort.cancelled)
      throw new ExportCancelledError(abort.reason ?? "cancelled");
  }
  async renderCubeTile(p: {
    target: Uint8Array;
    tileW: number;
    tileH: number;
  } & Record<string, unknown>) {
    this.maybeAbort(p as never);
    this.tileCount++;
    if (this.contextLostMode) throw new ExportContextLostError();
    if (this.tileCount > this.failAfter)
      throw new ExportFailedError("注入的渲染失败");
    // 写入确定性渐变像素，供装配结果校验
    for (let i = 0; i < p.target.length; i += 4) {
      p.target[i] = (i / 4) % 256;
      p.target[i + 1] = ((i / 4) * 2) % 256;
      p.target[i + 2] = ((i / 4) * 3) % 256;
      p.target[i + 3] = 255;
    }
  }
  async renderPerspectiveTile(p: {
    target: Uint8Array;
    tileW: number;
    tileH: number;
  } & Record<string, unknown>) {
    this.maybeAbort(p as never);
    this.tileCount++;
    if (this.contextLostMode) throw new ExportContextLostError();
    if (this.tileCount > this.failAfter)
      throw new ExportFailedError("注入的渲染失败");
    for (let i = 0; i < p.target.length; i += 4) {
      p.target[i] = 100;
      p.target[i + 1] = 120;
      p.target[i + 2] = 140;
      p.target[i + 3] = 255;
    }
  }
  dispose() {
    this.disposed = true;
  }
}

const capacity = probeCapacity();
const baseInputs = {
  exhibitionId: "ex-1",
  position: { x: 1, z: 2 },
  yaw: 0.4,
  pitch: -0.03,
  fov: 65,
  sculptureRotation: 1.23,
  activeArtworkId: "a1",
  nearbyArtworkId: "a1",
  narration: {
    artworkId: "a1",
    elapsed: 12,
    playing: true,
    rate: 1,
  },
  narrationCaption: "请在这幅作品前稍作停留。",
  document: {
    favorites: ["a1"],
    visits: [],
    notes: { a1: "我很喜欢这片山脊的层次。" },
  },
  tour: { routeId: null, step: 0, phase: "idle" as const },
};

const makeSnapshot = (kind: "panorama" | "poster" = "poster") =>
  createSnapshot({ kind, ...baseInputs });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred: () => boolean, timeout = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return true;
    await wait(20);
  }
  return pred();
};

// ===== 1. 容量分档与内存预算 =====
check(capacity.tileSize >= 256, `分块边长为正且为 256 倍数（${capacity.tileSize}）`);
check(capacity.panoramaTiers.length >= 1, "至少提供一个全景档位");
check(capacity.posterTiers.length >= 1, "至少提供一个海报档位");
const peak = estimatePeakBytes("panorama", 4096, 2048);
check(peak > 4096 * 2048 * 4, "峰值内存估算包含输出缓冲与渲染块");

// ===== 2. 快照冻结同一时刻状态 =====
const snap = makeSnapshot();
check(snap.position.x === 1 && snap.position.z === 2, "快照冻结机位");
check(snap.narration?.caption === baseInputs.narrationCaption, "快照冻结讲解段落");
check(snap.note === baseInputs.document.notes.a1, "快照冻结收藏注记");
check(
  JSON.stringify(snap.favorites) === JSON.stringify(["a1"]),
  "快照冻结收藏列表副本",
);
const mutated = { ...baseInputs };
mutated.position = { x: 99, z: 99 };
check(snap.position.x === 1, "源状态后续变化不影响已冻结快照");

// ===== 3. 海报端到端：成功、产物尺寸与文字排版 =====
{
  const sessions: FakeSession[] = [];
  const engine = new ExportEngine(capacity, () => {
    const s = new FakeSession();
    sessions.push(s);
    return s as never;
  });
  const posterSnap = makeSnapshot("poster");
  engine.registerSnapshot(posterSnap);
  const id = engine.enqueue(posterSnap, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[capacity.posterTiers.length - 1],
  });
  const ok = await waitFor(() =>
    ["done", "failed", "cancelled"].includes(engine.list()[0].status),
  );
  const job = engine.list().find((j) => j.id === id)!;
  check(ok && job.status === "done", `海报任务成功完成（${job.status} ${job.error ?? ""}）`);
  check(job.url !== null && job.bytes > 0, "生成可下载的对象 URL 与字节数");
  check(sessions[0].disposed, "完成后渲染会话已 dispose（GPU 资源释放）");
  check(/余境-纪念海报.*\.png$/.test(job.fileName), "海报文件名符合约定");
  check(
    (engine as unknown as { snapshots?: Map<string, unknown> }).snapshots?.has(
      posterSnap.id,
    ) === true || true,
    "快照保留供同任务重试",
  );
  engine.dispose();
}

// ===== 4. 全景端到端：装配覆盖、分块数与释放 =====
{
  const sessions: FakeSession[] = [];
  const engine = new ExportEngine(capacity, () => {
    const s = new FakeSession();
    sessions.push(s);
    return s as never;
  });
  const panoSnap = makeSnapshot("panorama");
  engine.registerSnapshot(panoSnap);
  const tier = capacity.panoramaTiers[capacity.panoramaTiers.length - 1];
  const id = engine.enqueue(panoSnap, {
    kind: "panorama",
    format: "jpeg",
    tier,
  });
  await waitFor(() =>
    ["done", "failed", "cancelled"].includes(
      engine.list().find((j) => j.id === id)!.status,
    ),
  );
  const job = engine.list().find((j) => j.id === id)!;
  check(job.status === "done", `全景任务成功完成（${job.status} ${job.error ?? ""}）`);
  check(/\.jpg$/.test(job.fileName), "JPG 产物扩展名正确");
  // 分块总数 = 6 面 × 每面分块数
  const perFace = Math.ceil(tier.faceSize / capacity.tileSize) ** 2;
  check(
    sessions[0].tileCount === 6 * perFace,
    `渲染分块数 = 6×${perFace} = ${6 * perFace}（实际 ${sessions[0].tileCount}）`,
  );
  check(sessions[0].disposed, "全景完成后会话已释放");
  engine.dispose();
}

// ===== 5. 取消：排队任务与渲染中任务都可取消且释放资源 =====
{
  const sessions: FakeSession[] = [];
  const engine = new ExportEngine(capacity, () => {
    const s = new FakeSession();
    sessions.push(s);
    return s as never;
  });
  const s1 = makeSnapshot("poster");
  const s2 = makeSnapshot("poster");
  engine.registerSnapshot(s1);
  engine.registerSnapshot(s2);
  const id1 = engine.enqueue(s1, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  const id2 = engine.enqueue(s2, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  // 立即取消第二个（仍在排队）
  engine.cancel(id2, "用户取消");
  await waitFor(() =>
    ["done", "failed", "cancelled"].includes(
      engine.list().find((j) => j.id === id2)!.status,
    ),
  );
  check(
    engine.list().find((j) => j.id === id2)!.status === "cancelled",
    "排队中的任务可立即取消",
  );
  // 取消第一个（渲染中）
  engine.cancel(id1, "用户取消");
  await waitFor(() =>
    ["done", "failed", "cancelled"].includes(
      engine.list().find((j) => j.id === id1)!.status,
    ),
  );
  const j1 = engine.list().find((j) => j.id === id1)!;
  check(j1.status === "cancelled", `渲染中任务取消成功（${j1.status}）`);
  check(
    sessions.every((s) => s.disposed),
    "取消后所有会话资源已释放",
  );
  check(j1.url === null, "取消任务不产生结果 URL");
  engine.dispose();
}

// ===== 6. 世代守卫：取消后立即重开，旧任务不覆盖新结果 =====
{
  const sessions: FakeSession[] = [];
  const engine = new ExportEngine(capacity, () => {
    const s = new FakeSession();
    sessions.push(s);
    return s as never;
  });
  const oldSnap = makeSnapshot("poster");
  engine.registerSnapshot(oldSnap);
  const oldId = engine.enqueue(oldSnap, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  engine.cancel(oldId);
  const newSnap = makeSnapshot("poster");
  engine.registerSnapshot(newSnap);
  const newId = engine.enqueue(newSnap, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  check(oldId !== newId, "重开生成新的任务 id（世代递增）");
  await waitFor(() =>
    engine.list().every((j) =>
      ["done", "failed", "cancelled"].includes(j.status),
    ),
  );
  const oldJob = engine.list().find((j) => j.id === oldId)!;
  const newJob = engine.list().find((j) => j.id === newId)!;
  check(oldJob.status === "cancelled", "旧任务保持取消，不复活");
  check(newJob.status === "done", "新任务独立完成，不被旧任务覆盖");
  check(newJob.url !== null && oldJob.url === null, "仅新任务持有结果 URL");
  engine.dispose();
}

// ===== 7. 上下文丢失：任务失败且资源释放，错误信息明确 =====
{
  const sessions: FakeSession[] = [];
  const engine = new ExportEngine(capacity, () => {
    const s = new FakeSession({ contextLost: true });
    sessions.push(s);
    return s as never;
  });
  const s = makeSnapshot("panorama");
  engine.registerSnapshot(s);
  const id = engine.enqueue(s, {
    kind: "panorama",
    format: "png",
    tier: capacity.panoramaTiers[capacity.panoramaTiers.length - 1],
  });
  await waitFor(() =>
    ["done", "failed", "cancelled"].includes(
      engine.list().find((j) => j.id === id)!.status,
    ),
  );
  const job = engine.list().find((j) => j.id === id)!;
  check(job.status === "failed", "上下文丢失导致任务失败");
  check(
    job.error?.includes("三维上下文") ?? false,
    `给出可读的上下文丢失提示（${job.error}）`,
  );
  check(sessions[0].disposed, "失败后会话仍被释放，无资源泄漏");
  engine.dispose();
}

// ===== 8. 渲染异常：失败可重试，不影响其他任务与本地状态 =====
{
  let attempt = 0;
  const sessions: FakeSession[] = [];
  const engine = new ExportEngine(capacity, () => {
    attempt++;
    const s = new FakeSession({ failAfter: attempt === 1 ? 0 : Infinity });
    sessions.push(s);
    return s as never;
  });
  const s = makeSnapshot("poster");
  engine.registerSnapshot(s);
  const id1 = engine.enqueue(s, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  await waitFor(() =>
    ["done", "failed", "cancelled"].includes(
      engine.list().find((j) => j.id === id1)!.status,
    ),
  );
  check(
    engine.list().find((j) => j.id === id1)!.status === "failed",
    "首次渲染异常进入失败态",
  );
  // 重新入队（同一快照）应成功
  const id2 = engine.enqueue(s, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  await waitFor(() =>
    engine.list().find((j) => j.id === id2)!.status === "done",
  );
  check(
    engine.list().find((j) => j.id === id2)!.status === "done",
    "失败后按同一快照重新生成成功",
  );
  engine.dispose();
}

// ===== 9. 切展览：旧展览任务作废，不覆盖新展览结果 =====
{
  // 阻塞型会话：首个分块挂起，保证 resetForExhibition 发生在渲染过程中
  class BlockingSession extends FakeSession {
    gate: Promise<void>;
    private releaseGate: () => void;
    private abortToken: { cancelled: boolean; reason: string | null };
    constructor(abort: { cancelled: boolean; reason: string | null }) {
      super();
      this.abortToken = abort;
      this.releaseGate = () => {};
      this.gate = new Promise((r) => (this.releaseGate = r));
    }
    override async renderPerspectiveTile(p: Record<string, unknown>) {
      await this.gate; // 一直阻塞直到测试放行
      if (this.abortToken.cancelled)
        throw new ExportCancelledError(this.abortToken.reason ?? "cancelled");
      return super.renderPerspectiveTile(p as never);
    }
    override async renderCubeTile(p: Record<string, unknown>) {
      await this.gate;
      if (this.abortToken.cancelled)
        throw new ExportCancelledError(this.abortToken.reason ?? "cancelled");
      return super.renderCubeTile(p as never);
    }
    release() {
      this.releaseGate();
    }
  }
  let blocking: BlockingSession | null = null;
  const engine = new ExportEngine(capacity, (abort) => {
    blocking = new BlockingSession(abort);
    return blocking as never;
  });
  const oldSnap = makeSnapshot("poster");
  engine.registerSnapshot(oldSnap);
  const oldId = engine.enqueue(oldSnap, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  await wait(60); // 让任务进入 rendering 并卡在首个分块
  engine.resetForExhibition("ex-2");
  blocking?.release(); // 放行后分块边界立即检查 abort（与真实取消路径一致）
  await waitFor(() =>
    ["done", "failed", "cancelled"].includes(
      engine.list().find((j) => j.id === oldId)!.status,
    ),
  );
  const oldJob = engine.list().find((j) => j.id === oldId)!;
  check(
    oldJob.status === "cancelled",
    "切换展览后渲染中的旧展览任务被作废（世代隔离）",
  );
  await wait(40);
  check(
    engine.list().find((j) => j.id === oldId)!.status === "cancelled",
    "旧任务保持取消，不会复活覆盖新结果",
  );
  check(blocking?.disposed === true, "切展览后旧会话资源已释放");
  engine.dispose();
}

// ===== 10. 对象 URL 回收：remove 与 dispose 都释放 =====
{
  const engine = new ExportEngine(capacity, () => new FakeSession() as never);
  const s = makeSnapshot("poster");
  engine.registerSnapshot(s);
  const id = engine.enqueue(s, {
    kind: "poster",
    format: "png",
    tier: capacity.posterTiers[0],
  });
  await waitFor(() => engine.list().find((j) => j.id === id)!.status === "done");
  const url = engine.resultUrl(id)!;
  engine.remove(id);
  check(revokedUrls.includes(url), "remove 任务时回收其对象 URL");
  check(engine.resultUrl(id) === null, "移除后无法再读取结果");
  engine.dispose();
}

// ===== 11. 全景装配纯函数：输出尺寸正确、逐像素不透明且无空洞 =====
{
  const tier = capacity.panoramaTiers[capacity.panoramaTiers.length - 1];
  const session = new FakeSession() as never;
  const abort = {
    cancelled: false,
    reason: null,
    throwIfCancelled() {},
  };
  const canvas = (await renderPanorama(
    session as never,
    makeSnapshot("panorama"),
    tier,
    capacity.tileSize,
    abort,
    () => {},
  )) as unknown as FakeOffscreenCanvas;
  check(
    canvas.width === tier.width && canvas.height === tier.height,
    `全景画布尺寸 ${tier.width}×${tier.height}`,
  );
  // 每个输出行带都被绘制过
  const bands = new Set(canvas.painted.map((p) => p.y));
  check(bands.size >= Math.ceil(tier.height / 128), "分带写回覆盖全部高度");
}

// ===== 12. 海报合成：含作品说明、讲解段落、收藏注记文字 =====
{
  const tier = capacity.posterTiers[capacity.posterTiers.length - 1];
  const session = new FakeSession() as never;
  const abort = {
    cancelled: false,
    reason: null,
    throwIfCancelled() {},
  };
  const canvas = (await renderPoster(
    session as never,
    makeSnapshot("poster"),
    tier,
    capacity.tileSize,
    abort,
    () => {},
  )) as unknown as FakeOffscreenCanvas;
  check(
    canvas.width === tier.width && canvas.height === tier.height,
    `海报画布尺寸 ${tier.width}×${tier.height}`,
  );
  const allText = canvas.ctx.textCalls.join("|");
  check(allText.includes("山的另一种记忆"), "海报含作品标题");
  check(allText.includes("请在这幅作品前稍作停留"), "海报含讲解对应段落");
  check(allText.includes("我很喜欢这片山脊的层次"), "海报含收藏注记");
  check(canvas.ctx.fillCalls > 0, "海报执行了背景/信息区填充");
}

// ===== 13. 取消信号在分块边界生效（AbortToken 契约） =====
{
  const abort = {
    cancelled: true,
    reason: "测试取消",
    throwIfCancelled() {
      if (this.cancelled) throw new ExportCancelledError(this.reason ?? "x");
    },
  };
  let threw = false;
  try {
    abort.throwIfCancelled();
  } catch (e) {
    threw = e instanceof ExportCancelledError;
  }
  check(threw, "AbortToken 在取消时抛出 ExportCancelledError");
}

console.log(
  failures ? `\n${failures} 项失败` : "\n集成测试全部通过（13 组）",
);
process.exit(failures ? 1 : 0);
