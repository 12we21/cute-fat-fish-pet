/**
 * 发布树对账：stage\ 是不是「仓库源码 + 三块外部运行时」原样铺出来的。
 * ===========================================================================
 * 本仓库的源码就是成品，没有「蓝本 + 覆盖 + 打补丁」这一层，所以对账只有一句话：
 * **stage 里每个来自仓库的文件，都必须和仓库里那份逐字节相同；反过来也一样。**
 * 另外外部件（electron\node\speech）只检查关键文件在不在、文件数对不对。
 *
 * 用法：
 *   node build\check-release.mjs            # 对账，人读输出，退出码 0/1
 *   node build\check-release.mjs --emit     # 额外打印可粘贴进 verify.mjs 的指纹块
 *   node build\check-release.mjs --stage <目录>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles, sha256File, treeFingerprint, never } from "./filters.mjs";
import { PIECES } from "./toolchain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);
const EMIT = argv.includes("--emit");
const si = argv.indexOf("--stage");
const STAGE = path.resolve(si >= 0 ? argv[si + 1] : path.join(ROOT, "stage"));

/** 仓库目录 → 发布树里的位置 */
const PAIRS = [
  ["src", "app"],
  ["launcher", "launcher"],
  ["standalone", "standalone"],
  ["defaults", "defaults"],
];
/** 仓库根 → 发布树根（安装/卸载脚本、说明、许可） */
const FLAT = ["install.ps1", "uninstall.ps1", "安装.cmd", "卸载.cmd", "LICENSE.txt", "使用说明.txt", "第三方声明.txt"];

let bad = 0;
const say = (...a) => console.log(...a);
const fail = (msg) => {
  bad++;
  say(`  ✗ ${msg}`);
};

if (!fs.existsSync(STAGE)) {
  console.error(`stage 不存在：${STAGE}\n先跑 node build\\build.mjs`);
  process.exit(2);
}
say(`发布树对账：${STAGE}`);
say(`仓库根    ：${ROOT}`);
say("");

// 1) 仓库 → 发布树，逐字节
for (const [srcRel, dstRel] of PAIRS) {
  const srcDir = path.join(ROOT, srcRel);
  const dstDir = path.join(STAGE, dstRel);
  const want = new Map(walkFiles(srcDir).map((f) => [f.rel, f]));
  const got = new Map(
    fs.existsSync(dstDir) ? walkFiles(dstDir, { filter: null }).map((f) => [f.rel, f]) : []
  );
  let same = 0;
  for (const [rel, w] of want) {
    const g = got.get(rel);
    if (!g) {
      fail(`${dstRel}/${rel} 在发布树里没有`);
      continue;
    }
    if (g.size !== w.size || sha256File(g.abs) !== sha256File(w.abs)) {
      fail(`${dstRel}/${rel} 与仓库不一致（仓库 ${w.size} B / 发布树 ${g.size} B）`);
      continue;
    }
    same++;
    got.delete(rel);
  }
  for (const rel of got.keys()) fail(`${dstRel}/${rel} 是发布树里多出来的（仓库里没有）`);
  say(`  ✓ ${srcRel}\\ → ${dstRel}\\：${same} 个文件逐字节一致`);
}

// 2) assets\ 平铺到发布树根
const assetsDir = path.join(ROOT, "assets");
let flat = 0;
for (const f of walkFiles(assetsDir)) {
  const dst = path.join(STAGE, f.rel);
  if (!fs.existsSync(dst)) {
    fail(`发布树根缺 ${f.rel}（来自 assets\\）`);
    continue;
  }
  if (fs.statSync(dst).size !== f.size || sha256File(dst) !== sha256File(f.abs)) {
    fail(`${f.rel} 与 assets\\ 里那份不一致`);
    continue;
  }
  flat++;
}
for (const name of FLAT) {
  if (!fs.existsSync(path.join(STAGE, name))) fail(`发布树根缺 ${name}`);
}
say(`  ✓ assets\\ → 根：${flat} 个文件一致（含 ${FLAT.length} 个安装/说明/许可）`);

// 3) verify.mjs 自己也要在发布树里（装完能自查）
const vm = path.join(ROOT, "verify.mjs");
if (!fs.existsSync(vm)) fail("仓库根少了 verify.mjs");
else if (!fs.existsSync(path.join(STAGE, "verify.mjs"))) fail("发布树里没有 verify.mjs");
else if (sha256File(vm) !== sha256File(path.join(STAGE, "verify.mjs"))) fail("发布树里的 verify.mjs 与仓库根那份不一致");
else say("  ✓ verify.mjs 也在发布树里，内容一致");

// 4) 外部件：关键文件在不在
for (const [key, spec] of Object.entries(PIECES)) {
  if (key === "toolchain") continue;
  const dir = path.join(STAGE, spec.dir);
  const missing = spec.expect.filter((m) => !fs.existsSync(path.join(dir, m)));
  if (missing.length) {
    fail(`${spec.dir}\\ 缺 ${missing.join("、")}`);
    continue;
  }
  const n = walkFiles(dir, { filter: null }).length;
  say(`  ✓ ${spec.label}：${spec.dir}\\ 关键文件齐（整块 ${n} 个文件）`);
}

// 5) 运行期状态 / 开发期垃圾一个都不许混进发布树
const junk = [];
for (const f of walkFiles(STAGE, { filter: null })) if (never(f.rel)) junk.push(f.rel);
if (junk.length) {
  for (const j of junk.slice(0, 20)) fail(`发布树里有不该进包的东西：${j}`);
  if (junk.length > 20) fail(`…还有 ${junk.length - 20} 个`);
} else {
  say("  ✓ 运行期状态与开发期残留：0 个");
}

// 6) 三块运行时之外，发布树顶层只该有这些
const TOP_OK = new Set([
  "app", "electron", "launcher", "node", "speech", "standalone", "defaults",
  "verify.mjs", "install.ps1", "uninstall.ps1", "安装.cmd", "卸载.cmd",
  "LICENSE.txt", "使用说明.txt", "第三方声明.txt",
]);
const extraTop = fs.readdirSync(STAGE).filter((n) => !TOP_OK.has(n));
if (extraTop.length) for (const n of extraTop) fail(`发布树顶层多了：${n}`);
else say("  ✓ 发布树顶层结构正确");

// 7) --emit：给 verify.mjs 用的指纹（--write 直接写进 verify.mjs 的标记区）
const GENERATED = (() => {
  const fp = (rel) => treeFingerprint(path.join(STAGE, rel), { filter: null });
  const dirs = { app: "app", launcher: "launcher", standalone: "standalone", defaults: "defaults" };
  const L = [];
  L.push("// >>>GENERATED 由 build\\check-release.mjs --emit --write 生成，别手改这一段");
  L.push("const EXPECT = {");
  for (const [k, rel] of Object.entries(dirs)) {
    const f = fp(rel);
    L.push(`  ${k}: { files: ${f.files}, bytes: ${f.bytes}, treeSha256: "${f.treeSha256}" },`);
  }
  L.push("};");
  L.push("");
  L.push("// 我们自己写的那些关键文件：大小 + sha256（不含 verify.mjs 自己 —— 它一改哈希就变）");
  L.push("const OURS = {");
  const ours = [
    "app/lib/index.js",
    "app/runtime/electron-helper/main.js",
    "app/runtime/electron-helper/sprite.js",
    "app/runtime/electron-helper/targets.js",
    "app/runtime/electron-helper/shared-core.js",
    "app/runtime/electron-helper/events.js",
    "launcher/main.js",
    "launcher/index.html",
    "launcher/preload.js",
    "launcher/paths.js",
    "launcher/update.js",
    "launcher/pet-api.js",
    "launcher/rec.js",
    "launcher/agent.js",
    "launcher/pet.ico",
    "launcher/package.json",
    "standalone/main.mjs",
    "standalone/server.mjs",
    "standalone/context.mjs",
    "standalone/detect.mjs",
    "standalone/paths.mjs",
    "standalone/online.mjs",
    "standalone/ollama.mjs",
    "standalone/check.mjs",
    "standalone/stop-pet.mjs",
    "standalone/start-pet.vbs",
    "standalone/stop-pet.vbs",
  ];
  let skipped = 0;
  for (const rel of ours) {
    const p = path.join(STAGE, rel);
    if (!fs.existsSync(p)) {
      skipped++;
      continue;
    }
    L.push(`  '${rel}': [${fs.statSync(p).size}, '${sha256File(p)}'],`);
  }
  if (skipped) L.push(`  // 注意：有 ${skipped} 个候选文件在 stage 里不存在，已跳过`);
  L.push("};");
  L.push("// <<<GENERATED");
  return L.join("\n");
})();

if (EMIT) {
  say("");
  say(GENERATED);
  say("");
}

if (argv.includes("--write")) {
  const vmFile = path.join(ROOT, "verify.mjs");
  if (!fs.existsSync(vmFile)) {
    fail("--write 需要仓库根的 verify.mjs，但没找到");
  } else {
    const text = fs.readFileSync(vmFile, "utf8");
    const re = /\/\/ >>>GENERATED[\s\S]*?\/\/ <<<GENERATED/;
    if (!re.test(text)) {
      fail("verify.mjs 里找不到 >>>GENERATED / <<<GENERATED 标记，没法写入");
    } else {
      fs.writeFileSync(vmFile, text.replace(re, GENERATED));
      say(`  ✓ 已把新指纹写进 verify.mjs（${(GENERATED.length / 1024).toFixed(1)} KB 的生成段）`);
    }
  }
}

say("");
if (bad) {
  say(`结论：不合格 —— ${bad} 处问题（stage 得重铺：node build\\build.mjs）`);
  process.exit(1);
}
say("结论：全部通过 —— stage 与仓库源码逐字节一致，外部件齐，没有垃圾混进去。");
