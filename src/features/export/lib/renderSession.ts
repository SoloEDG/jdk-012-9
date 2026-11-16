import * as THREE from "three";
import type { ExportSnapshot } from "./snapshot";
import { buildScene, disposeScene } from "../../space/lib/buildScene";

/** 可中止任务的令牌，渲染循环在每个分块边界检查 */
export interface AbortToken {
  cancelled: boolean;
  reason: string | null;
  throwIfCancelled(): void;
}

export class ExportCancelledError extends Error {
  constructor(reason = "cancelled") {
    super(reason);
    this.name = "ExportCancelledError";
  }
}
export class ExportContextLostError extends Error {
  constructor() {
    super("webgl-context-lost");
    this.name = "ExportContextLostError";
  }
}
export class ExportFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFailedError";
  }
}

type AxisName = "x" | "y" | "z";
export type CubeFace = {
  id: number;
  axis: AxisName;
  sign: 1 | -1;
  uAxis: AxisName;
  uSign: 1 | -1;
  vAxis: AxisName;
  vSign: 1 | -1;
};

/**
 * 立方体面方向约定（与 THREE.CubeCamera 的 lookAt 约定一致，相机看向法线 +n）：
 *  局部 z 轴 = -n，右向量 u 由 cross(up, -n) 得到，上向量 v = cross(-n, u)
 *  px:+X(u=+Z,v=+Y) nx:-X(u=-Z,v=+Y)
 *  py:+Y(u=-X,v=-Z) ny:-Y(u=-X,v=+Z)
 *  pz:+Z(u=-X,v=+Y) nz:-Z(u=+X,v=+Y)
 */
export const CUBE_FACES: CubeFace[] = [
  { id: 0, axis: "x", sign: 1, uAxis: "z", uSign: 1, vAxis: "y", vSign: 1 },
  { id: 1, axis: "x", sign: -1, uAxis: "z", uSign: -1, vAxis: "y", vSign: 1 },
  { id: 2, axis: "y", sign: 1, uAxis: "x", uSign: -1, vAxis: "z", vSign: -1 },
  { id: 3, axis: "y", sign: -1, uAxis: "x", uSign: -1, vAxis: "z", vSign: 1 },
  { id: 4, axis: "z", sign: 1, uAxis: "x", uSign: -1, vAxis: "y", vSign: 1 },
  { id: 5, axis: "z", sign: -1, uAxis: "x", uSign: 1, vAxis: "y", vSign: 1 },
];

export type CubeTileParams = {
  face: CubeFace;
  faceSize: number;
  tileX: number;
  tileY: number;
  tileW: number;
  tileH: number;
  target: Uint8Array;
  snapshot: ExportSnapshot;
};

export type PerspectiveTileParams = {
  fullW: number;
  fullH: number;
  tileX: number;
  tileY: number;
  tileW: number;
  tileH: number;
  target: Uint8Array;
  snapshot: ExportSnapshot;
};

/**
 * 每次导出任务独立的渲染会话：
 * - 使用独立离屏 WebGLRenderer，与主展厅的实时渲染器互不抢占；
 * - 场景独立构建，分块期间几何体/材质保持不变，接缝处无重复或缺失；
 * - 任务结束（成功/取消/失败）后释放全部 GPU 资源并主动丢失上下文。
 */
export class RenderSession {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly onLost: (e: Event) => void;
  private lost = false;
  private pending: ((e: Error) => void) | null = null;
  private sculpture: THREE.Object3D;

  private constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    sculpture: THREE.Object3D,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.sculpture = sculpture;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 80);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.onLost = (e: Event) => {
      e.preventDefault();
      this.lost = true;
      this.pending?.(new ExportContextLostError());
      this.pending = null;
    };
    renderer.domElement.addEventListener("webglcontextlost", this.onLost);
  }

  static create(abort: AbortToken): RenderSession {
    const canvas = document.createElement("canvas");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      });
    } catch (err) {
      throw new ExportFailedError(
        `无法创建离屏渲染上下文：${err instanceof Error ? err.message : "未知错误"}`,
      );
    }
    const { scene, sculpture } = buildScene();
    const session = new RenderSession(renderer, scene, sculpture);
    abort.throwIfCancelled();
    return session;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  /** 让分块渲染与实时展厅共享同一个冻结时刻：雕塑转动角度也固定 */
  private applyFrozenMoment(snapshot: ExportSnapshot) {
    this.camera.position.set(snapshot.position.x, 1.7, snapshot.position.z);
    this.sculpture.rotation.y = snapshot.sculptureRotation;
  }

  /** 渲染单个立方体面分块，像素写入 target（自底向上的 GL 行序） */
  renderCubeTile(p: CubeTileParams): Promise<void> {
    return this.guard(
      () => {
        this.applyFrozenMoment(p.snapshot);
        const f = p.face;
        const pos = this.camera.position;
        const n = new THREE.Vector3();
        n[f.axis] = f.sign;
        const u = new THREE.Vector3();
        u[f.uAxis] = f.uSign;
        const v = new THREE.Vector3();
        v[f.vAxis] = f.vSign;
        // 观察矩阵以相机位置为原点的三个正交基（右 u、上 v、前 -n）
        const m = new THREE.Matrix4().makeBasis(u, v, n.clone().negate());
        this.camera.quaternion.setFromRotationMatrix(m);
        this.camera.position.copy(pos);
        this.camera.aspect = 1;
        this.camera.fov = 90;
        this.camera.updateProjectionMatrix();
        this.resizeTarget(p.tileW, p.tileH);
        this.renderer.setRenderTarget(this.target);
        this.renderer.setViewport(0, 0, p.tileW, p.tileH);
        this.renderer.setScissorTest(false);
        this.renderer.clear(true, true, true);
        this.renderer.render(this.scene, this.camera);
        this.renderer.readRenderTargetPixels(
          this.target,
          0,
          0,
          p.tileW,
          p.tileH,
          p.target,
        );
        this.renderer.setRenderTarget(null);
      },
      "立方体面分块渲染失败",
    );
  }

  /**
   * 平面海报的单分块透视渲染。
   * 使用 setViewOffset 做无重叠、无缝隙的视锥裁切：
   * 每个分块只覆盖全画面的一个矩形，逐像素恰好渲染一次，
   * 因此分块接缝、遮挡关系与透明/金属物体不会重复或缺失。
   */
  renderPerspectiveTile(p: PerspectiveTileParams): Promise<void> {
    return this.guard(
      () => {
        this.applyFrozenMoment(p.snapshot);
        this.camera.rotation.set(p.snapshot.pitch, p.snapshot.yaw, 0);
        this.camera.fov = p.snapshot.fov;
        this.camera.aspect = p.fullW / p.fullH;
        // full 宽高下偏移到本分块；投影矩阵自动保持与整帧完全一致的透视
        this.camera.setViewOffset(
          p.fullW,
          p.fullH,
          p.tileX,
          p.tileY,
          p.tileW,
          p.tileH,
        );
        this.camera.updateProjectionMatrix();
        this.resizeTarget(p.tileW, p.tileH);
        this.renderer.setRenderTarget(this.target);
        this.renderer.setViewport(0, 0, p.tileW, p.tileH);
        this.renderer.setScissorTest(false);
        this.renderer.clear(true, true, true);
        this.renderer.render(this.scene, this.camera);
        this.renderer.readRenderTargetPixels(
          this.target,
          0,
          0,
          p.tileW,
          p.tileH,
          p.target,
        );
        this.renderer.setRenderTarget(null);
        // 复位，避免影响后续分块
        this.camera.clearViewOffset();
        this.camera.updateProjectionMatrix();
      },
      "海报透视分块渲染失败",
    );
  }

  private resizeTarget(w: number, h: number) {
    if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
    }
  }

  /** 上下文丢失时以失败 reject；同步异常包装为导出失败 */
  private guard(work: () => void, message: string): Promise<void> {
    if (this.lost) return Promise.reject(new ExportContextLostError());
    return new Promise<void>((resolve, reject) => {
      this.pending = (e: Error) => reject(e);
      try {
        work();
        if (this.lost) {
          reject(new ExportContextLostError());
        } else {
          resolve();
        }
      } catch (err) {
        reject(
          err instanceof ExportContextLostError
            ? err
            : new ExportFailedError(
                `${message}：${err instanceof Error ? err.message : "未知错误"}`,
              ),
        );
      } finally {
        this.pending = null;
      }
    });
  }

  dispose() {
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.onLost,
    );
    this.target.dispose();
    disposeScene(this.scene);
    const ext = this.renderer.getContext().getExtension("WEBGL_lose_context");
    this.renderer.dispose();
    // 主动归还 GPU 句柄，取消/失败后不残留临时资源
    ext?.loseContext();
    this.lost = true;
  }
}

/** 分块计划：把 faceSize/全画面切成不重叠矩形，每边不超过 tileSize */
export function planTiles(
  totalW: number,
  totalH: number,
  tileSize: number,
): { x: number; y: number; w: number; h: number }[] {
  const tiles: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < totalH; y += tileSize) {
    for (let x = 0; x < totalW; x += tileSize) {
      tiles.push({
        x,
        y,
        w: Math.min(tileSize, totalW - x),
        h: Math.min(tileSize, totalH - y),
      });
    }
  }
  return tiles;
}

/**
 * 每完成若干分块把主线程让给交互渲染，保持参观流畅。
 * 页面切到后台时 setTimeout 仍会执行，只是被节流，任务不中断。
 */
export async function yieldToMain(
  counter: { n: number; last: number },
  abort: AbortToken,
): Promise<void> {
  counter.n += 1;
  const now = performance.now();
  if (counter.n % 2 === 0 && now - counter.last >= 40) {
    counter.last = now;
    await new Promise((r) => setTimeout(r, 0));
    abort.throwIfCancelled();
  }
}
