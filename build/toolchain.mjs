/**
 * toolchain.mjs —— 三块「外部件」的定位与校验
 * ---------------------------------------------------------------------------
 * 本仓库里 `src\`（应用本体）、`launcher\`（控制台）、`standalone\`（免安装运行器）、
 * `defaults\`、`assets\` 都是源码，克隆下来就有。但发布包里还有三块**几百 MB 的运行时**，
 * 不适合塞进 git，它们是：
 *
 *   electron\   Electron 43.3.0 win-x64 运行时（75 个文件，约 347 MB）
 *   node\       node v24.21.0 win-x64（3 个文件，约 89 MB）—— 语音识别必须用真 node.exe：
 *               SenseVoice 的原生插件在 Electron 里加载会抛 "External buffers are not allowed"
 *   speech\     sherpa-onnx 原生引擎 + SenseVoice int8 模型（8 个文件，约 253 MB）
 *
 * 找法（第一个能用的就用）：
 *   1. 命令行：--toolchain <目录> / --electron <目录> / --node <目录> / --speech <目录>
 *   2. 环境变量：BLUEHAIRMAID_TOOLCHAIN / BLUEHAIRMAID_ELECTRON / _NODE / _SPEECH
 *   3. 常见安装位置：%LOCALAPPDATA%\BlueHairMaid、%ProgramFiles%\BlueHairMaid、%USERPROFILE%\BlueHairMaid
 *   4. 语音包额外兜底：BLUEHAIRMAID_SHERPA（sherpa 那几个 .dll/.node 所在目录）
 *                      + BLUEHAIRMAID_STT_MODELS（sensevoice-onnx / silero 所在目录）
 *
 * 找不到不会静默跳过：`build.mjs` 会直接报错并告诉你缺什么、三种补齐方式。
 * `node build\toolchain.mjs` 可以单独查一遍现状。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(HERE);

/** 每块外部件的「必须存在」清单（相对该块自身根目录）。 */
export const PIECES = {
  electron: {
    label: "Electron 运行时",
    dir: "electron",
    envs: ["BLUEHAIRMAID_ELECTRON"],
    cli: "--electron",
    expect: [
      "electron.exe",
      "icudtl.dat",
      "resources.pak",
      "version",
      "LICENSES.chromium.html",
      "resources/default_app.asar",
      "locales/zh-CN.pak",
    ],
    // 版本钉死：包里的 helper 是按这个 Electron 大版本调过的，别拿别的糊上去
    wantVersion: { file: "version", equals: "43.3.0" },
  },
  node: {
    label: "node 运行时（语音识别用）",
    dir: "node",
    envs: ["BLUEHAIRMAID_NODE"],
    cli: "--node",
    expect: ["bin/node.exe", "LICENSE"],
    wantVersion: { bin: "bin/node.exe", prefix: "v24." },
  },
  speech: {
    label: "语音引擎与模型（sherpa-onnx + SenseVoice）",
    dir: "speech",
    envs: ["BLUEHAIRMAID_SPEECH"],
    cli: "--speech",
    expect: [
      "sherpa/sherpa-onnx.node",
      "sherpa/onnxruntime.dll",
      "sherpa/sherpa-onnx-c-api.dll",
      "sensevoice/models/sensevoice-onnx/model.int8.onnx",
      "sensevoice/models/sensevoice-onnx/tokens.txt",
      "sensevoice/models/silero/silero_vad.onnx",
    ],
  },
};

const toWin = (p) => p.split("/").join(path.sep);

/** 常见安装位置（都是通用的系统位置，不含任何本机专属路径） */
export function defaultRoots() {
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, "BlueHairMaid"));
  if (process.env.ProgramFiles) add(path.join(process.env.ProgramFiles, "BlueHairMaid"));
  if (process.env["ProgramFiles(x86)"]) add(path.join(process.env["ProgramFiles(x86)"], "BlueHairMaid"));
  if (process.env.USERPROFILE) add(path.join(os.homedir(), "BlueHairMaid"));
  return out;
}

/** 解析命令行里 --toolchain/--electron/... 的值（build.mjs 与单独运行都用它） */
export function parseOverrideArgs(argv = process.argv.slice(2)) {
  const out = { toolchain: null, electron: null, node: null, speech: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    for (const key of Object.keys(out)) {
      if (a === `--${key}` && argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
      else if (a.startsWith(`--${key}=`)) out[key] = a.slice(key.length + 3);
    }
  }
  return out;
}

/** 这块目录算不算「齐」；返回 {ok, missing[], version} */
export function inspect(piece, dir) {
  const spec = PIECES[piece];
  const base = spec.dir;
  const root = base && path.basename(dir).toLowerCase() === base ? path.dirname(dir) : dir;
  const target = base ? path.join(root, base) : dir;
  const missing = [];
  if (!fs.existsSync(target)) return { ok: false, dir: target, missing: ["(整个目录不存在)"], version: null };
  for (const rel of spec.expect) {
    if (!fs.existsSync(path.join(target, toWin(rel)))) missing.push(rel);
  }
  let version = null;
  if (spec.wantVersion?.file) {
    const f = path.join(target, toWin(spec.wantVersion.file));
    if (fs.existsSync(f)) version = fs.readFileSync(f, "utf8").trim();
  } else if (spec.wantVersion?.bin) {
    const f = path.join(target, toWin(spec.wantVersion.bin));
    if (fs.existsSync(f)) version = `(见 ${spec.wantVersion.bin} 文件名/内部版本)`;
  }
  return { ok: missing.length === 0, dir: target, missing, version };
}

/**
 * 找到一块外部件。
 * @returns {{ok:boolean, dir:string|null, tried:string[], missing:string[], reason?:string}}
 */
export function locate(piece, { override = null, toolchain = null, extraRoots = [] } = {}) {
  const spec = PIECES[piece];
  const tried = [];
  const candidates = [];
  const envDir = spec.envs.map((e) => process.env[e]).find(Boolean);
  if (override) candidates.push(override);
  if (envDir) candidates.push(envDir);
  if (toolchain) candidates.push(toolchain);
  for (const r of extraRoots) candidates.push(r);
  candidates.push(...defaultRoots());

  for (const c of candidates) {
    if (!c) continue;
    tried.push(c);
    const got = inspect(piece, c);
    if (got.ok) {
      const warn = [];
      if (spec.wantVersion?.equals && got.version && got.version !== spec.wantVersion.equals) {
        warn.push(`版本是 ${got.version}，建议 ${spec.wantVersion.equals}`);
      }
      return { ok: true, dir: got.dir, tried, missing: [], warn };
    }
    // 记录第一个候选缺什么，报错时好写清楚
    if (!tried._missing) tried._missing = got.missing;
  }
  return {
    ok: false,
    dir: null,
    tried,
    missing: tried._missing || PIECES[piece].expect,
    reason: `没找到可用的${spec.label}`,
  };
}

/** 缺件时给用户的三种补齐方式 */
export function howToGet(piece) {
  const spec = PIECES[piece];
  const lines = [];
  lines.push(`  ① 如果这台电脑上装过「可爱大肥鱼桌宠」：把 --toolchain 指到安装目录`);
  lines.push(`     （默认装在 %LOCALAPPDATA%\\BlueHairMaid，里面就有 ${spec.dir}\\）`);
  lines.push(`  ② 或者把这块单独指出来：build\\build.mjs ${spec.cli} <目录>`);
  lines.push(`     也可以用环境变量 ${spec.envs[0]}=<目录>`);
  if (piece === "electron") {
    lines.push(`  ③ 全新机器：按 Electron 43.3.0 官方发行版解压一份 win-x64（含 resources\\ 与 locales\\）`);
    lines.push(`     https://github.com/electron/electron/releases/tag/v43.3.0`);
  } else if (piece === "node") {
    lines.push(`  ③ 全新机器：Node.js v24 win-x64 官方 zip，把 bin\\node.exe 与 LICENSE 放齐`);
    lines.push(`     https://nodejs.org/dist/`);
  } else {
    lines.push(`  ③ sherpa-onnx 预编译包（win-x64 的 .dll/.node）+ SenseVoice int8 模型（model.int8.onnx、tokens.txt）`);
    lines.push(`     https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.14`);
    lines.push(`     模型：ModelScope「iic/SenseVoiceSmall」或 HuggingFace「FunAudioLLM/SenseVoiceSmall」`);
    lines.push(`     也可以两块分开指：BLUEHAIRMAID_SHERPA=<sherpa 目录>  BLUEHAIRMAID_STT_MODELS=<models 目录>`);
  }
  return lines.join("\n");
}

// 直接运行：把三块的现状打出来
if (import.meta.url === `file://${process.argv[1]?.split(path.sep).join("/")}` || process.argv[1]?.endsWith("toolchain.mjs")) {
  const o = parseOverrideArgs();
  console.log("外部件现状（不进 git 的三块运行时）");
  for (const piece of Object.keys(PIECES)) {
    const got = locate(piece, { override: o[piece], toolchain: o.toolchain });
    const spec = PIECES[piece];
    if (got.ok) {
      const files = (function count(d) {
        let n = 0;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? count(path.join(d, e.name)) : 1;
        return n;
      })(got.dir);
      console.log(`  OK   ${spec.label}`);
      console.log(`       ${got.dir}（${files} 个文件）${got.warn?.length ? "  ⚠ " + got.warn.join("；") : ""}`);
    } else {
      console.log(`  缺   ${spec.label} —— 找过 ${got.tried.length} 个位置都不齐`);
      console.log(`       缺：${got.missing.join("、")}`);
      console.log(howToGet(piece));
    }
  }
  console.log(`\n仓库根：${ROOT}`);
}
