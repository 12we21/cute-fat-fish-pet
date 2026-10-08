/**
 * 发布版路径规则（CJS 版，给控制台主进程用；与 ..\standalone\paths.mjs 规则一致）
 *   安装目录只读（装的时候可以自己选）；用户数据按优先级：
 *   环境变量 DSH_PET_DATA_DIR > 程序目录\data-root.txt > 程序目录\portable.txt（→ 程序目录\userdata）> %APPDATA%\BlueHairMaid
 */
const { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const APP_NAME = "BlueHairMaid";
const DISPLAY_NAME = "蓝毛小女仆";

function appDataDir() {
  return process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming");
}

/** 用户数据根在哪（与 paths.mjs 的 dataRootInfo 同一套规则） */
function dataRootInfo(root, env = process.env) {
  const envDir = String(env.DSH_PET_DATA_DIR || "").trim();
  if (envDir) return { userRoot: resolve(root, envDir), source: "env", file: null };
  const file = join(root, "data-root.txt");
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#"));
    if (line) return { userRoot: resolve(root, line), source: "file", file };
  }
  if (existsSync(join(root, "portable.txt"))) return { userRoot: join(root, "userdata"), source: "portable", file: join(root, "portable.txt") };
  return { userRoot: join(appDataDir(), APP_NAME), source: "appdata", file: null };
}

/** @param {string} launcherDir launcher\ 目录绝对路径 */
function resolvePaths(launcherDir) {
  const root = dirname(launcherDir); // 安装根
  const data = dataRootInfo(root);
  const userRoot = data.userRoot;
  return {
    root,
    portable: data.source !== "appdata",
    dataRootSource: data.source,
    dataRootFile: data.file,
    userRoot,
    dataRoot: join(userRoot, "dsh-pet"),
    consoleUserData: join(userRoot, "console"),
    deviceProfile: join(userRoot, "device-profile.json"),
    defaultsDir: join(root, "defaults", "dsh-pet"),
    electronExe: join(root, "electron", "electron.exe"),
    appDir: join(root, "app"),
    standaloneDir: join(root, "standalone"),
    runnerMain: join(root, "standalone", "main.mjs"),
    launcherDir,
    // 语音包（随包分发）
    speechDir: join(root, "speech"),
    sherpaAddon: join(root, "speech", "sherpa", "sherpa-onnx.node"),
    sileroModel: join(root, "speech", "sensevoice", "models", "silero", "silero_vad.onnx"),
    nodeExe: join(root, "node", "bin", "node.exe"),
  };
}

/**
 * 语音输入那三样外挂（stt-worker.mjs 只认这些环境变量）+ 真 node.exe。
 * 与 ..\standalone\paths.mjs 的 speechEnv 保持同一套规则。
 */
function speechEnv(paths) {
  const out = {};
  if (existsSync(paths.sherpaAddon)) out.DSH_PET_SHERPA_ADDON = paths.sherpaAddon;
  if (existsSync(paths.sileroModel)) out.DSH_PET_SILERO_MODEL = paths.sileroModel;
  if (existsSync(paths.speechDir)) out.DSH_SPEECH_DIR = paths.speechDir;
  if (existsSync(paths.nodeExe)) out.DSH_PET_NODE = paths.nodeExe;
  return out;
}

/** 首次运行铺默认数据：只补缺的，绝不覆盖已有的 */
function seedUserData(paths) {
  let made = 0;
  if (!existsSync(paths.defaultsDir)) return made;
  const walk = (from, to) => {
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name);
      const dst = join(to, e.name);
      if (e.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        walk(src, dst);
      } else if (!existsSync(dst)) {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        made++;
      }
    }
  };
  mkdirSync(paths.dataRoot, { recursive: true });
  walk(paths.defaultsDir, paths.dataRoot);
  return made;
}

function readDeviceProfile(paths) {
  try {
    return JSON.parse(readFileSync(paths.deviceProfile, "utf8"));
  } catch {
    return null;
  }
}

module.exports = { APP_NAME, DISPLAY_NAME, appDataDir, dataRootInfo, resolvePaths, seedUserData, readDeviceProfile, speechEnv };
