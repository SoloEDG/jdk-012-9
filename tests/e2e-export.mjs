// 端到端验证：真实无头 Chrome + 软件 WebGL 跑通海报/全景导出。
// 运行：node tests/e2e-export.mjs
import puppeteer from "puppeteer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log("ok  :", msg);
  else {
    failures++;
    console.error("FAIL:", msg);
  }
};

const server = await createServer({
  root,
  configFile: false,
  server: { port: 0, host: "127.0.0.1" },
  logLevel: "error",
});
await server.listen();
const url = `http://127.0.0.1:${server.config.server.port}/`;

const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.CHROME_BIN ||
    "/home/node/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome",
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(url, { waitUntil: "networkidle0" });
  await sleep(800);

  check(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    }),
    "无头浏览器可创建 WebGL 上下文",
  );
  check(!!(await page.$(".viewport canvas")), "主展厅三维画布已挂载");

  await page.click('button[aria-label="生成纪念影像"]');
  await page.waitForSelector(".export-modal");

  // 在页面内解码 blob，返回尺寸与像素方差（全黑/全空时方差为 0）
  const inspectResult = (jobId) =>
    page.evaluate(async (id) => {
      const engine = window.__exportEngine;
      const blobUrl = engine.resultUrl(id);
      if (!blobUrl) return null;
      const blob = await fetch(blobUrl).then((r) => r.blob());
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let sum = 0;
      let sumSq = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += lum;
        sumSq += lum * lum;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      return {
        width: bmp.width,
        height: bmp.height,
        bytes: blob.size,
        variance: Math.round(variance),
      };
    }, jobId);

  const pickTier = (keyword) =>
    page.evaluate((kw) => {
      const radios = [...document.querySelectorAll('input[name="tier"]')];
      radios.find((r) => r.closest(".tier").textContent.includes(kw))?.click();
    }, keyword);
  const pickFormat = (keyword) =>
    page.evaluate((kw) => {
      [...document.querySelectorAll('input[name="format"]')]
        .find((r) => r.closest("label").textContent.includes(kw))
        ?.click();
    }, keyword);
  const start = () => page.click(".export-actions .primary");
  const latestJobId = () =>
    page.evaluate(() => window.__exportEngine.list()[0]?.id ?? null);
  const waitStatus = async (predicate, timeout = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await page.evaluate(predicate);
      if (ok) return true;
      await sleep(300);
    }
    return false;
  };

  // ---- 海报标清 JPG ----
  await pickTier("标清");
  await pickFormat("JPG");
  await start();
  const posterId = await latestJobId();
  check(
    await waitStatus(() =>
      ["done", "failed"].includes(window.__exportEngine.list()[0]?.status),
    ),
    "海报任务到达终态",
  );
  const poster = await inspectResult(posterId);
  check(
    poster && poster.width === 1240 && poster.height === 1754 && poster.bytes > 0,
    `海报尺寸 1240×1754 且有字节（实际 ${poster?.width}×${poster?.height}, ${poster?.bytes}B）`,
  );
  check(
    poster && poster.variance > 50,
    `海报含真实渲染内容而非空画面（亮度方差 ${poster?.variance}）`,
  );

  // ---- 全景标清 PNG ----
  await page.click('.export-kind-switch button[role="tab"]:nth-child(2)');
  await pickTier("标清");
  await pickFormat("PNG");
  await start();
  const panoId = await latestJobId();
  check(
    await waitStatus(() =>
      ["done", "failed"].includes(window.__exportEngine.list()[0]?.status),
    ),
    "全景任务到达终态",
  );
  const pano = await inspectResult(panoId);
  check(
    pano && pano.width === 2048 && pano.height === 1024,
    `全景尺寸 2048×1024（实际 ${pano?.width}×${pano?.height}）`,
  );
  check(pano && pano.variance > 50, `全景含真实渲染内容（方差 ${pano?.variance}）`);

  // 全景首尾接缝列的平均颜色应几乎一致
  const seam = await page.evaluate(async (id) => {
    const blob = await fetch(window.__exportEngine.resultUrl(id)).then((r) =>
      r.blob(),
    );
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const col = (x) => {
      const d = ctx.getImageData(x, 0, 1, bmp.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return s / bmp.height;
    };
    return { left: col(0), right: col(bmp.width - 1) };
  }, panoId);
  check(
    Math.abs(seam.left - seam.right) < 2,
    `全景环绕接缝首尾列亮度一致（差 ${Math.abs(seam.left - seam.right).toFixed(2)}）`,
  );

  // ---- 世代守卫：取消正在进行的任务后立即重开，旧任务不覆盖新结果 ----
  await page.click('.export-kind-switch button[role="tab"]:nth-child(1)');
  await pickTier("超清"); // 分块更多，便于在渲染中取消
  await start();
  const oldId = await latestJobId();
  await sleep(200);
  await page.evaluate((id) => window.__exportEngine.cancel(id), oldId);
  await sleep(200);
  await start(); // 立即再次开始
  const newId = await latestJobId();
  check(oldId !== newId, "取消后立即重开生成了新任务 id");
  check(
    await waitStatus(() => {
      const jobs = window.__exportEngine.list();
      const old = jobs.find((j) => j.id === oldId);
      return old && ["cancelled", "failed"].includes(old.status);
    }),
    "被取消的旧任务停留在取消/失败，不会复活覆盖新结果",
  );
  check(
    await waitStatus(
      () =>
        window.__exportEngine.list().find((j) => j.id === newId)?.status ===
        "done",
      120000,
    ),
    "新任务独立完成",
  );

  // ---- 清除任务会回收对象 URL ----
  const beforeRemove = await page.evaluate(
    (id) => !!window.__exportEngine.resultUrl(id),
    panoId,
  );
  await page.evaluate((id) => window.__exportEngine.remove(id), panoId);
  const afterRemove = await page.evaluate(
    (id) => window.__exportEngine.resultUrl(id),
    panoId,
  );
  check(beforeRemove && afterRemove === null, "清除任务后对象 URL 已回收");

  await page.screenshot({ path: resolve(root, "tests/export-dialog.png") });

  const fatal = consoleErrors.filter(
    (t) =>
      !t.includes("favicon") &&
      !t.includes("Failed to load resource") &&
      !/swiftshader|GPU|WebGL|GL |metal|ANGLE/i.test(t),
  );
  check(
    fatal.length === 0,
    `无未捕获运行时错误（${fatal.length} 条：${fatal.slice(0, 2).join(" | ")}）`,
  );
  console.log("\n截图已写入 tests/export-dialog.png");
} finally {
  await browser.close();
  await server.close();
}

console.log(failures ? `\n${failures} 项失败` : "\n端到端断言全部通过");
process.exit(failures ? 1 : 0);
