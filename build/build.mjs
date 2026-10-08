/**
 * 可爱大肥鱼桌宠 · 打包器（独立构建）
 * ===========================================================================
 * 这个仓库**不再有**「上游蓝本 + overlay 覆盖 + patch-app.mjs 打补丁」那一套。
 * `src\` 里就是完整源码（打完所有历史补丁的成品），所以构建只做两件事：
 *
 *   1. 把仓库里的源码树按发布版结构铺进 stage\
 *   2. 把三块几百 MB、不进 git 的外部运行时（electron\node\speech）从
 *      「这台电脑上的一份安装」或命令行指的地方复制进来（见 build\toolchain.mjs）
 *
 * 铺出来的 stage\ 就是最终应用：安装器把它整个装到 %LOCALAPPDATA%\BlueHairMaid；
 * zip 也是把它整棵压起来。每一步都能单独跑（改完控制台只铺 launcher 就行）。
 *
 * 用法：
 *   node build\build.mjs                    全部铺一遍（第一次、或改了多处）
 *   node build\build.mjs launcher assets    只铺这几块（改代码后最常用）
 *   node build\build.mjs --list             只列会做什么，不动磁盘
 *   node build\build.mjs --clean            先删掉 stage\ 再来
 *   node build\build.mjs --no-gate          跳过隐私路径门禁（不推荐）
 *   node build\build.mjs --toolchain "D:\某处\BlueHairMaid"
 *   node build\toolchain.mjs                只查三块外部件齐不齐
 *
 * 块名：app launcher standalone defaults assets verify electron node speech
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PIECES, locate, parseOverrideArgs, howToGet } from "./toolchain.mjs";
import { never } from "./filters.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const STAGE = path.join(ROOT, "stage");
const APP_NAME = "BlueHairMaid";

const argv = process.argv.slice(2);
const LIST_ONLY = argv.includes("--list");
const CLEAN = argv.includes("--clean");
const NO_GATE = argv.includes("--no-gate");
const doGate = !NO_GATE;
const over = parseOverrideArgs(argv);
const BLOCKS = ["app", "launcher", "standalone", "defaults", "assets", "verify", "electron", "node", "speech"];
const VALUED = ["--toolchain", "--electron", "--node", "--speech"];
const what = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    if (VALUED.includes(a)) i++; // 跳过它的值
    continue;
  }
  what.push(a);
}
const unknown = what.filter((k) => !BLOCKS.includes(k));
if (unknown.length) {
  console.error(`不认识的块名：${unknown.join("、")}\n可用块：${BLOCKS.join(" ")}`);
  process.exit(2);
}
const want = (k) => what.length === 0 || what.includes(k);

let copied = 0;
let skipped = 0;
let bytes = 0;
const log = (...a) => console.log(...a);

/** 逐文件复制：能打印、能过滤、能跳过没变的文件 */
function copyTree(from, to, { label = "", filter = never, root = from } = {}) {
  if (!fs.existsSync(from)) {
    log(`  [跳过] ${label || from} —— 源不存在`);
    return { files: 0, bytes: 0 };
  }
  const items = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      const rel = path.relative(root, p);
      if (filter && filter(rel)) {
        log(`  [剔除] ${rel}`);
        continue;
      }
      items.push([p, rel]);
    }
  })(from);

  let n = 0;
  let b = 0;
  for (const [src, rel] of items) {
    const dst = path.join(to, rel);
    if (LIST_ONLY) {
      log(`  [将复制] ${path.relative(ROOT, dst) || rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const st = fs.statSync(src);
    let same = false;
    try {
      const dt = fs.statSync(dst);
      same = dt.size === st.size && dt.mtimeMs >= st.mtimeMs;
    } catch {}
    if (same) {
      skipped++;
      n++;
      continue;
    }
    fs.copyFileSync(src, dst);
    copied++;
    n++;
    b += st.size;
    bytes += st.size;
  }
  const rel = path.relative(ROOT, to) || ".";
  log(`  [${label || rel}] ${rel} ← ${from}：${items.length} 个文件${LIST_ONLY ? "（未动磁盘）" : ""}`);
  return { files: items.length, bytes: b };
}

/** 外部件：直接从「那份安装」或命令行指的地方搬过来 */
function copyToolchain(piece) {
  const spec = PIECES[piece];
  const got = locate(piece, { override: over[piece], toolchain: over.toolchain });
  if (!got.ok) {
    log("");
    log(`✗ ${spec.label} 找不到：${got.dir || "(无)"}`);
    log(`  找过 ${got.tried.length} 处，都缺：${got.missing.join("、")}`);
    log(howToGet(piece));
    log("");
    throw new Error(`外部件缺失：${piece}`);
  }
  if (got.warn?.length) for (const w of got.warn) log(`  ⚠ ${spec.label}：${w}`);
  copyTree(path.join(got.dir), path.join(STAGE, spec.dir), { label: spec.label });
  return got.dir;
}

// ---------------------------------------------------------------- 开工
log(`可爱大肥鱼桌宠 · 打包  ${LIST_ONLY ? "(只看不做)" : ""}`);
log(`  仓库   : ${ROOT}`);
log(`  暂存树 : ${STAGE}`);
log("");

if (CLEAN && !LIST_ONLY) {
  fs.rmSync(STAGE, { recursive: true, force: true });
  log("  已清空 stage\\");
}

// 0) 隐私路径门禁：宁可在这挡住，也别把作者/用户的路径打进发布包
if (doGate && !LIST_ONLY) {
  const gate = path.join(HERE, "check-paths.mjs");
  if (fs.existsSync(gate)) {
    log("[门禁] 扫一遍源码里的本机路径（build\\check-paths.mjs）");
    try {
      const out = execFileSync(process.execPath, [gate], { encoding: "utf8" });
      for (const line of out.trim().split("\n")) log(`    ${line}`);
    } catch (e) {
      log(`    ${(e.stdout || "").trim()}`);
      log(`    ${(e.stderr || "").trim()}`);
      log("");
      log("✗ 门禁没过：源码里还有本机路径。修掉，或用 --no-gate 强行继续（不推荐）。");
      process.exit(1);
    }
  } else {
    log("[门禁] 跳过：build\\check-paths.mjs 还没就位");
  }
}

if (want("app")) {
  // src\ 就是成品源码：一个字节都不用在构建期改（补丁机制已删除）
  copyTree(path.join(ROOT, "src"), path.join(STAGE, "app"), { label: "app 本体" });
}
if (want("launcher")) {
  copyTree(path.join(ROOT, "launcher"), path.join(STAGE, "launcher"), { label: "控制台" });
}
if (want("standalone")) {
  copyTree(path.join(ROOT, "standalone"), path.join(STAGE, "standalone"), { label: "免安装运行器" });
}
if (want("defaults")) {
  // defaults\dsh-pet\* 会在首次运行时铺到 %APPDATA%\BlueHairMaid\dsh-pet\
  copyTree(path.join(ROOT, "defaults"), path.join(STAGE, "defaults"), { label: "默认数据" });
}
if (want("assets")) {
  // assets\ 里的安装/卸载脚本、说明、许可直接落到 stage\ 根
  copyTree(path.join(ROOT, "assets"), STAGE, { label: "安装器/说明/许可" });
}
if (want("verify")) {
  const src = path.join(ROOT, "verify.mjs");
  if (!fs.existsSync(src)) {
    log("  [跳过] verify.mjs 不存在");
  } else if (LIST_ONLY) {
    log("  [将复制] verify.mjs（发布版自校验）");
  } else {
    fs.mkdirSync(STAGE, { recursive: true });
    fs.copyFileSync(src, path.join(STAGE, "verify.mjs"));
    copied++;
    bytes += fs.statSync(src).size;
    log("  [verify] verify.mjs 已带上（装完能自己核对整树指纹）");
  }
}
if (want("electron")) copyToolchain("electron");
if (want("node")) copyToolchain("node");
if (want("speech")) copyToolchain("speech");

if (!LIST_ONLY) {
  log("");
  log(`完成：新复制/覆盖 ${copied} 个文件（${(bytes / 1048576).toFixed(1)} MB），已是最新而跳过 ${skipped} 个。`);
  log(`暂存树：${STAGE}`);
  log(`下一步：node "${path.join(ROOT, "stage", "verify.mjs")}"  ← 在 stage 里自校验`);
  log(`安装器会把 stage\\ 整个装到 %LOCALAPPDATA%\\${APP_NAME}`);
}
