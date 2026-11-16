// 独立验证全景投影数学：与 src/features/export/lib/panorama.ts 保持同一份逻辑
// 运行：node -I verifyProjection.mjs （脚本位于 tests 目录，不读取任何外部输入）
const CUBE_FACES = [
  { id: 0, axis: "x", sign: 1, uAxis: "z", uSign: -1, vAxis: "y", vSign: 1 },
  { id: 1, axis: "x", sign: -1, uAxis: "z", uSign: 1, vAxis: "y", vSign: 1 },
  { id: 2, axis: "y", sign: 1, uAxis: "x", uSign: 1, vAxis: "z", vSign: -1 },
  { id: 3, axis: "y", sign: -1, uAxis: "x", uSign: 1, vAxis: "z", vSign: 1 },
  { id: 4, axis: "z", sign: 1, uAxis: "x", uSign: 1, vAxis: "y", vSign: 1 },
  { id: 5, axis: "z", sign: -1, uAxis: "x", uSign: -1, vAxis: "y", vSign: 1 },
];
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// 与引擎 panorama.ts 保持一致：近零分量归零，消除环绕接缝的 1px 取整差
const quantizeZero = (v) => (Math.abs(v) < 1e-12 ? 0 : v);

function pickFace(dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  if (ax >= ay && ax >= az) return CUBE_FACES[dx > 0 ? 0 : 1];
  if (ay >= ax && ay >= az) return CUBE_FACES[dy > 0 ? 2 : 3];
  return CUBE_FACES[dz > 0 ? 4 : 5];
}

function sampleFace(faceSize, dx, dy, dz) {
  const face = pickFace(dx, dy, dz);
  const d = [dx, dy, dz];
  const normal = d[AXIS_INDEX[face.axis]] * face.sign;
  const sc = 1 / normal;
  const r = d[AXIS_INDEX[face.uAxis]] * face.uSign * sc;
  const b = d[AXIS_INDEX[face.vAxis]] * face.vSign * sc;
  const px = clamp01((r + 1) / 2) * (faceSize - 1);
  const pyBottom = clamp01((b + 1) / 2) * (faceSize - 1);
  return { face: face.id, px: Math.round(px), py: Math.round(pyBottom) };
}

// 立方体面中心射线方向：面中心的世界方向就是法线 +n
function centerRay(face) {
  const n = [0, 0, 0];
  n[AXIS_INDEX[face.axis]] = face.sign;
  const u = [0, 0, 0];
  u[AXIS_INDEX[face.uAxis]] = face.uSign;
  const v = [0, 0, 0];
  v[AXIS_INDEX[face.vAxis]] = face.vSign;
  const dir = n;
  return { dir, u, v, n };
}

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// 1. 每个立方体面的中心射线必须落回该面中心（采样取整，允许 1px 误差）
const FACE = 512;
const CENTER = (FACE - 1) / 2;
for (const face of CUBE_FACES) {
  const { dir } = centerRay(face);
  const s = sampleFace(FACE, dir[0], dir[1], dir[2]);
  assert(
    s.face === face.id &&
      Math.abs(s.px - CENTER) <= 1 &&
      Math.abs(s.py - CENTER) <= 1,
    `面 ${face.id} 中心射线映射回本面中心（得到 face=${s.face}, px=${s.px}, py=${s.py}）`,
  );
}

// 2. 面四角方向映射到对应角，且 u 向右、v 向上
{
  const f = CUBE_FACES[4]; // +Z 面：u=-X, v=+Y，中心 +Z
  const { n } = centerRay(f);
  const u = [0, 0, 0]; u[0] = -1;
  const v = [0, 0, 0]; v[1] = 1;
  const k = 0.8;
  const dir = n.map((x, i) => x + u[i] * k + v[i] * k);
  const s = sampleFace(FACE, dir[0], dir[1], dir[2]);
  // pz 面 u=-X：r=-k，px=((1-k)/2)*(FACE-1)；v=+Y：b=+k，py=((1+k)/2)*(FACE-1)
  const expectedPx = Math.round(((1 - k) / 2) * (FACE - 1));
  const expectedPy = Math.round(((1 + k) / 2) * (FACE - 1));
  assert(
    s.face === 4 && s.px === expectedPx && s.py === expectedPy,
    `+Z 面右上角映射到理论 UV(${expectedPx},${expectedPy})（得到 ${s.face},${s.px},${s.py}）`,
  );
  const dir2 = n.map((x, i) => x - u[i] * k + v[i] * k);
  const s2 = sampleFace(FACE, dir2[0], dir2[1], dir2[2]);
  assert(
    s2.face === 4 && s2.px === expectedPy && s2.py === expectedPy,
    `+Z 面左上角映射到理论 UV(${expectedPy},${expectedPy})（得到 ${s2.face},${s2.px},${s2.py}）`,
  );
}

// 3. 接缝连续性：theta=-π 与 theta=+π 是同一世界方向，像素列必须采样到相同面/UV；
//    当该方向恰好压在两个立方体法线面的精确边界上时，浮点选面可能不同，
//    此时两者都必须落在面边缘（px=0/max），引擎的钳制采样保证不会出现黑洞。
for (const yaw of [0, 0.7, -1.3, 2.1]) {
  const H = 1024;
  let bad = 0;
  for (let y = 0; y < H; y++) {
    const phi = Math.PI / 2 - (Math.PI * y) / H;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const minusPi = yaw - Math.PI;
    const plusPi = yaw + Math.PI;
    const a = sampleFace(
      FACE,
      quantizeZero(cp * Math.sin(minusPi)),
      quantizeZero(sp),
      quantizeZero(cp * Math.cos(minusPi)),
    );
    const b = sampleFace(
      FACE,
      quantizeZero(cp * Math.sin(plusPi)),
      quantizeZero(sp),
      quantizeZero(cp * Math.cos(plusPi)),
    );
    if (a.face === b.face) {
      if (a.px !== b.px || a.py !== b.py) bad++;
      continue;
    }
    const onEdge = (p) => p.px === 0 || p.px === FACE - 1;
    if (!(onEdge(a) && onEdge(b))) bad++;
  }
  assert(bad === 0, `yaw=${yaw} 等距柱状首尾接缝采样一致（面边界行落在共享边）`);
}

// 4. 等距柱状采样覆盖所有 6 个面且无越界像素
{
  const W = 1024, H = 512, yaw = 0.5;
  const seen = new Set();
  let outOfRange = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const theta = yaw + (2 * Math.PI * x) / W - Math.PI;
      const phi = Math.PI / 2 - (Math.PI * y) / H;
      const s = sampleFace(
        FACE,
        Math.cos(phi) * Math.sin(theta),
        Math.sin(phi),
        Math.cos(phi) * Math.cos(theta),
      );
      seen.add(s.face);
      if (s.px < 0 || s.px >= FACE || s.py < 0 || s.py >= FACE) outOfRange++;
    }
  }
  assert(seen.size === 6, `全景覆盖全部 6 个立方体面（实际 ${seen.size} 个）`);
  assert(outOfRange === 0, "所有采样坐标均在面缓冲范围内");
}

// 5. 正前方（与 yaw 同向）出现在全景水平正中
for (const yaw of [0, Math.PI / 2, -Math.PI / 3]) {
  const W = 4096, H = 2048;
  const fwd = [Math.sin(yaw), 0, Math.cos(yaw)];
  const center = sampleFace(FACE, fwd[0], fwd[1], fwd[2]);
  const midX = Math.floor(W / 2);
  const theta = yaw + (2 * Math.PI * midX) / W - Math.PI;
  const phi = Math.PI / 2 - (Math.PI * (H / 2)) / H;
  const atMid = sampleFace(
    FACE,
    Math.cos(phi) * Math.sin(theta),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(theta),
  );
  assert(
    atMid.face === center.face && Math.abs(atMid.px - center.px) <= 1,
    `yaw=${yaw.toFixed(2)} 正前方出现在全景水平中央`,
  );
}

// 6. 分块计划不重叠、不留缝，且完全覆盖目标矩形
function planTiles(totalW, totalH, tileSize) {
  const tiles = [];
  for (let y = 0; y < totalH; y += tileSize)
    for (let x = 0; x < totalW; x += tileSize)
      tiles.push({ x, y, w: Math.min(tileSize, totalW - x), h: Math.min(tileSize, totalH - y) });
  return tiles;
}
for (const [tw, th, ts] of [[2048, 2048, 512], [1024, 1024, 256], [1654, 1025, 512]]) {
  const tiles = planTiles(tw, th, ts);
  const grid = new Uint8Array(tw * th);
  let bad = 0;
  for (const t of tiles)
    for (let y = t.y; y < t.y + t.h; y++)
      for (let x = t.x; x < t.x + t.w; x++) {
        if (grid[y * tw + x]++) bad++;
      }
  const covered = grid.every((v) => v === 1);
  assert(!bad && covered, `分块 ${tw}x${th} @${ts} 无重叠且全覆盖（${tiles.length} 块）`);
}

console.log(failures ? `\n${failures} 项失败` : "\n全部投影/分块断言通过");
process.exit(failures ? 1 : 0);
