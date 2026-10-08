/**
 * selftest-rec-route.cjs —— 验证发布版 launcher\rec.js 的「她在哪」逻辑
 * ---------------------------------------------------------------------------
 * 背景（必须永久守住，别再退回 3080）：
 *   运行器把 runtime.json 写在**数据根**里（standalone\main.mjs 的 RUNTIME_FILE = <数据根>\runtime.json）。
 *   蓝本 rec.js 读的是 <repo>\standalone\runtime.json —— 那个文件不存在，于是永远回落到 3080，
 *   而同一台机器上 3080 常常坐着蓝本那只桌宠（主人自己的那只）。后果：控制台的「让她说这句话」
 *   和 AI agent 的每一步 /quip 都会打到别人家的桌宠上。实测复现过。
 *
 * 跑法：node build\selftest-rec-route.cjs      （全部 ok → exit 0）
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DIST = path.resolve(__dirname, "..");
const FILE = path.join(DIST, "overlay", "launcher", "rec.js");

const cases = [];
function check(name, ok, extra) {
  cases.push({ name, ok: !!ok, extra: extra === undefined ? "" : ` → ${extra}` });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra === undefined ? "" : ` → ${extra}`}`);
}

// ① 源码里不该再出现 3080 这个回落值
const src = fs.readFileSync(FILE, "utf8");
// 注释里可以提到 3080（解释为什么不能回落），代码里不许有 `|| 3080` 这种回落
check("rec.js 代码里没有 `|| 3080` 回落", !/\|\|\s*3080/.test(src));
check("rec.js 里读的是 PATHS.userRoot\\runtime.json", src.includes('const RUNTIME_FILE = path.join(PATHS.userRoot, "runtime.json");'));
check("record.json 跟着数据根走", src.includes("const DATA_ROOT = PATHS.dataRoot;"));

// ② 造一个临时数据根，按场景改 runtime.json，再看 petRoute()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recroute-"));
process.env.DSH_PET_DATA_DIR = tmp;
const rec = require(FILE);

const RUNTIME = path.join(tmp, "runtime.json");
function writeRuntime(obj) {
  if (obj === null) {
    try {
      fs.rmSync(RUNTIME);
    } catch {
      /* 本来就没有 */
    }
    return;
  }
  fs.writeFileSync(RUNTIME, JSON.stringify(obj), "utf8");
}

// 场景 A：没在跑（没有 runtime.json）—— 老代码在这里给出 3080
writeRuntime(null);
const a = rec.petRoute();
check("没有 runtime.json → port 0（不是 3080）", a.port === 0 && a.running === false, JSON.stringify(a));

// 场景 B：在跑（pid = 本进程，肯定活着；端口随便写一个非 3080 的）
writeRuntime({ pid: process.pid, port: 38517 });
const b = rec.petRoute();
check("runtime.json 里 pid 活着 → 用它记的端口", b.port === 38517 && b.running === true, JSON.stringify(b));

// 场景 C：上次没退干净（pid 已经不存在了）
const dead = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
writeRuntime({ pid: dead.pid || 999999, port: 38517 });
const c = rec.petRoute();
check("runtime.json 里 pid 已死 → port 0（不猜、不乱连）", c.port === 0 && c.running === false, JSON.stringify(c));

// 场景 D：没在跑时 say() 直接说「没在跑」，不去碰任何端口
(async () => {
  const s = await rec.say("测试");
  check('没在跑时 say() → reason "pet-offline"', s.ok === false && s.reason === "pet-offline", JSON.stringify(s));

  // 场景 E：录屏设置（record.json）写在数据根里，不写程序目录
  const want = "X:\\录制测试";
  rec.writeRecord({ outDir: want });
  const inData = path.join(tmp, "dsh-pet", "record.json");
  const inRepo = path.join(rec.REPO, "dsh-pet", "record.json");
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(inData, "utf8"));
  } catch {
    /* 没写出来 */
  }
  check("writeRecord() 写进 <数据根>\\dsh-pet\\record.json", !!(parsed && parsed.outDir === want), inData);
  check("writeRecord() 没写进程序目录 <repo>\\dsh-pet", !fs.existsSync(inRepo), inRepo);
  check("readRecord() 能读回来", rec.readRecord().outDir === want);

  fs.rmSync(tmp, { recursive: true, force: true });
  const bad = cases.filter((x) => !x.ok);
  console.log("");
  if (bad.length) {
    console.log(`✗ ${bad.length}/${cases.length} 条不过`);
    process.exit(1);
  }
  console.log(`✓ ${cases.length}/${cases.length} 全过`);
})();
