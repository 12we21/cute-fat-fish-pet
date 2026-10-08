#!/usr/bin/env node
/**
 * check-paths.mjs —— 「隐私路径门禁」：打包/发布前扫一遍会进包的源码，
 * 一旦发现**本机专属**的绝对路径或字符串就非零退出，并把 file:line 打出来。
 *
 * 为什么需要它（用户第 6 点）：.gitignore 只能挡住新产生的大文件，挡不住「源码里写死了
 * 作者的 C:\Users\<用户名>\…」这种泄露 —— 一旦进包，用户的装机路径、作者机器的目录结构
 * 就跟着发布出去了。所以这道门禁在 build.mjs 里跑（`node build\build.mjs` 的第 0 步），
 * 过不了就别打包。
 *
 * 用法：
 *   node build\check-paths.mjs                 # 扫默认根（= 本脚本上一级，即仓库根）
 *   node build\check-paths.mjs --root <dir>    # 换一个根（自测/扫别的副本时用）
 *   node build\check-paths.mjs --json          # 机器可读输出（build.mjs / CI 用）
 *   node build\check-paths.mjs --help
 *
 * 退出码（稳定契约，build.mjs 依赖它）：
 *   0 = 干净；1 = 有命中（详情已在 stdout）；2 = 用法/路径错误
 *
 * 扫描范围 = 会进发布包的源码 + 构建脚本 + 文档（SCAN_TARGETS）。
 * docs\ 不进发布包，但它会随仓库公开（README / 架构文档 / 发布说明），
 * 里面的本机路径同样是隐私泄露面，所以一并扫。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── 扫描根：本脚本住在 <仓库根>\build\ 下，默认根就是上一级。
 *    不写死任何机器路径 —— 这文件自己就是「别写死路径」的执行者。 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

/** 要扫的子树（相对根）：= 会进发布包的源码块 + build\ 里的构建脚本 */
const SCAN_TARGETS = ['src', 'launcher', 'standalone', 'defaults', 'assets', 'docs', 'verify.mjs', 'build'];
/** 根目录下的浅层文本文件也扫一遍（.gitignore / .gitattributes / LICENSE / verify.mjs…），不递归 */
const SCAN_ROOT_FILES = true;

/** 整棵跳过的目录：依赖、版本库、构建产物、工具缓存（都不进包，也不是「源码」） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'stage', 'release', 'dist', 'out', 'coverage', '__pycache__', '.vscode', '.idea']);
/** 跳过的扩展名：二进制/图片/字体/压缩包/音频视频，以及构建日志（.gitignore 里 /build/*.log 已忽略） */
const SKIP_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.exe', '.dll', '.node', '.zip', '.7z', '.rar', '.gz', '.tar', '.sha256',
  '.mp3', '.mp4', '.wav', '.webm', '.pdf', '.log', '.pyc',
]);
/** 单文件上限：超过就跳过（源码不该这么大；真是文本的话另行确认） */
const MAX_BYTES = 8 * 1024 * 1024;

/* ── 白名单：**不算命中**的形式。每条都写清为什么安全。 ───────────────────────── */
/**
 * 允许出现在 `...\Users\<这里>\...` 或 `/Users|/home/<这里>/` 里的名字。
 * 全是「任何机器上都存在」或「一眼是占位符」的名字；真实用户名（含本机的）不在其中。
 */
const ALLOWED_ACCOUNTS = new Map([
  ['public', 'Windows 公共目录，所有机器都有（main.js 里 process.env.PUBLIC 的兜底值）'],
  ['default', '系统预置配置目录，所有机器都有（build\\toolchain.mjs 拿它当默认值）'],
  ['default user', '英文系统上同一目录的写法'],
  ['all users', '老式 Windows 的公共目录写法'],
  ['you', '文档里的占位用户名'],
  ['user', '示例/文档里的占位用户名'],
  ['username', '示例/文档里的占位用户名'],
  ['someone', '测试用的占位用户名（src\\src\\host\\storage-paths.test.ts）'],
  ['example', '示例占位用户名'],
  ['test', '测试占位用户名'],
  ['u', '单字母测试桩家目录（同上，/home/u）—— 测试假值，不是真账户'],
]);
/**
 * 结构上就已排除的占位形式（写在这里是给读的人交代口径，不参与匹配）：
 *   C:\Users\<用户名>、C:\Users\%USERNAME%、C:\Users\$env:USERNAME、C:\Users\{user}、C:\Users\…
 * —— 规则里的「用户名」只认 字母/数字/._-（\p{L} 覆盖中文名），这些写法取不出名字，自然不命中。
 */
/** 系统级/注册表位置：与「谁的机器」无关，任何机器都长这样 */
const ALLOWED_SYSTEM_PATHS = [
  'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Windows', 'C:\\ProgramData',
  'HKCU:\\Software', 'HKLM:\\Software',
];

/** 本机专属字符串（拆成两半拼接：这些标记本身就要被扫，写整会让扫描器扫到自身） */
const MACHINE_STRINGS = ['1968' + '6', 'dsh' + '-pet-' + 'dist', 'dsh' + '-pet-' + 'bluehair'];

/* ── 规则 ──────────────────────────────────────────────────────────────────── */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 是占位名吗（大小写不敏感；带 … * ? 这类记号的也算） */
function isPlaceholderAccount(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return true;
  if (ALLOWED_ACCOUNTS.has(n)) return true;
  if (/^[%.$<{\[]/.test(n)) return true; // %USERNAME% / $env:X / <用户> / {user} / [name]
  return /[…*?]/.test(n);
}

const RULES = [
  {
    id: 'win-home',
    name: 'Windows 真实用户主目录',
    hint: '改成运行时推导（Electron: app.getPath(\'userData\')/process.resourcesPath；纯 node: os.homedir()/环境变量），或用 C:\\Users\\Public、%USERPROFILE% 这类占位/公共形式',
    // 用户名只取「字母/数字/._-」这一段：这样 C:\Users\Public、%USERPROFILE% 里的 Public 能被正确
    // 取出来走白名单，而中文用户名（\p{L} 覆盖）照样能抓到；`、%…<` 之类的分隔符一律不进捕获。
    re: /(?<![A-Za-z0-9_])([A-Za-z]):[\\/]+Users[\\/]+([\p{L}\p{N}._-]+)/giu,
    check: (m) => !isPlaceholderAccount(m[2]),
  },
  {
    id: 'posix-home',
    name: 'macOS/Linux 真实用户主目录',
    hint: '改成 os.homedir() / $HOME 推导，或用 /home/<user> 这类占位形式',
    re: /(?<![A-Za-z0-9._-])\/(?:Users|home)\/([A-Za-z0-9._-]+)/g,
    check: (m) => !isPlaceholderAccount(m[1]),
  },
  {
    id: 'machine-dir',
    name: '本机专属盘符目录',
    hint: '这台机器的开发/安装目录（磁盘根下的 deeps / 测试 等）：改成环境变量或配置项，别写死',
    re: /(?<![A-Za-z0-9_])([A-Za-z]):[\\/]+(?:deeps|测试)/gi,
  },
];

/** 本机专属字面串编译成规则（旧仓名、本机用户名…） */
const LITERAL_RULES = MACHINE_STRINGS.map((s) => ({
  id: /^\d+$/.test(s) ? 'machine-string' : 'old-repo-name',
  name: /^\d+$/.test(s) ? '本机用户名等专属字符串' : '旧发布仓/旧蓝本名',
  hint: '这串字符只属于某台机器/某个旧仓库：删掉或换成中性占位',
  re: new RegExp('(?<![0-9A-Za-z_])' + escapeRe(s) + '(?![0-9A-Za-z_])', 'gi'),
}));

const ACTIVE_RULES = [...RULES, ...LITERAL_RULES];

/** 命中是否落在系统级路径里（如 C:\Program Files 下的东西）→ 放行 */
function insideAllowedSystemPath(text, index, len) {
  const seg = text.slice(Math.max(0, index - 32), index + len);
  return ALLOWED_SYSTEM_PATHS.some((p) => seg.includes(p) || seg.replace(/\//g, '\\').includes(p));
}

/* ── 走文件系统 ─────────────────────────────────────────────────────────────── */
function walk(target, root, out, stats) {
  const abs = resolve(root, target);
  if (!existsSync(abs)) {
    stats.missing.push(target);
    return;
  }
  const st = statSync(abs);
  if (st.isFile()) {
    if (isScannable(abs, st)) out.push(abs);
    return;
  }
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    const p = join(abs, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(relative(root, p), root, out, stats);
      continue;
    }
    if (!ent.isFile()) continue;
    if (SKIP_EXTS.has(extname(ent.name).toLowerCase())) continue;
    let fst;
    try {
      fst = statSync(p);
    } catch {
      continue;
    }
    if (fst.size > MAX_BYTES) {
      stats.skippedBig.push(relative(root, p));
      continue;
    }
    out.push(p);
  }
}

function isScannable(abs, st) {
  if (SKIP_EXTS.has(extname(abs).toLowerCase())) return false;
  return st.size <= MAX_BYTES;
}

function scanFile(abs, root) {
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return [];
  }
  if (text.includes('\u0000')) return []; // 二进制（扩展名没盖住的那种）
  const rel = relative(root, abs);
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of ACTIVE_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (m[0] === '') {
          rule.re.lastIndex++;
          continue;
        }
        if (rule.check && !rule.check(m)) continue;
        if (insideAllowedSystemPath(line, m.index, m[0].length)) continue;
        found.push({
          file: rel,
          line: i + 1,
          rule: rule.id,
          ruleName: rule.name,
          hint: rule.hint,
          text: line.trim().slice(0, 200),
        });
        break; // 一行同一条规则只报一次
      }
    }
  }
  return found;
}

/* ── CLI ───────────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT, json: false, help: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--root') {
      const v = argv[++i];
      if (!v) out.error = '--root 后面要跟一个目录';
      else out.root = resolve(v);
    } else if (a.startsWith('--root=')) out.root = resolve(a.slice('--root='.length));
    else out.error = '未知参数：' + a;
  }
  return out;
}

const USAGE = [
  '隐私路径门禁 —— 打包前扫一遍会进包的源码，发现本机专属路径/字符串就非零退出。',
  '',
  '用法：',
  '  node build\\check-paths.mjs               扫默认根（本脚本上一级 = 仓库根）',
  '  node build\\check-paths.mjs --root <dir>  换扫描根',
  '  node build\\check-paths.mjs --json        机器可读输出',
  '',
  '退出码：0 = 干净；1 = 有命中；2 = 用法/路径错误',
].join('\n');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + '\n');
    process.exitCode = 0;
    return;
  }
  if (args.error) {
    process.stderr.write('[check-paths] ' + args.error + '\n\n' + USAGE + '\n');
    process.exitCode = 2;
    return;
  }
  if (!existsSync(args.root) || !statSync(args.root).isDirectory()) {
    process.stderr.write('[check-paths] 扫描根不存在或不是目录：' + args.root + '\n');
    process.exitCode = 2;
    return;
  }

  const root = args.root;
  const stats = { missing: [], skippedBig: [] };
  const files = [];
  const seen = new Set();
  for (const target of SCAN_TARGETS) walk(target, root, files, stats);
  if (SCAN_ROOT_FILES) {
    for (const ent of readdirSync(root, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const p = join(root, ent.name);
      if (!isScannable(p, statSync(p))) continue;
      files.push(p);
    }
  }
  const uniqFiles = files.filter((f) => (seen.has(f) ? false : (seen.add(f), true)));

  const rawHits = [];
  for (const f of uniqFiles) rawHits.push(...scanFile(f, root));
  // 同一行被多条规则命中（例如 C:\Users\<真名> 同时中 win-home 和 machine-string）只报一条
  const byLine = new Map();
  for (const h of rawHits) {
    const k = h.file + ':' + h.line;
    if (byLine.has(k)) continue;
    byLine.set(k, h);
  }
  const hits = [...byLine.values()];
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));

  const allowlist = {
    accounts: [...ALLOWED_ACCOUNTS.keys()],
    systemPaths: ALLOWED_SYSTEM_PATHS,
    note: '这些形式不算命中；口径见 build\\check-paths.mjs 顶部注释',
  };

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: hits.length === 0,
          root,
          targets: SCAN_TARGETS,
          filesScanned: uniqFiles.length,
          missingTargets: stats.missing,
          skippedTooBig: stats.skippedBig,
          hits,
          allowlist,
        },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = hits.length ? 1 : 0;
    return;
  }

  const out = [];
  out.push('隐私路径门禁 · check-paths');
  out.push('扫描根：' + root);
  out.push('扫描范围：' + SCAN_TARGETS.join('、') + (SCAN_ROOT_FILES ? '（+ 根目录文本文件）' : ''));
  out.push('跳过：node_modules/.git/stage/release/… 与二进制、图片、字体、压缩包、构建日志');
  if (stats.missing.length) out.push('（不存在的范围，已跳过：' + stats.missing.join('、') + '）');
  out.push('');
  if (!hits.length) {
    out.push(`扫了 ${uniqFiles.length} 个文件：干净 —— 没有本机专属路径/字符串。`);
    out.push('白名单（不算命中）：' + allowlist.accounts.join('、') + '；' + ALLOWED_SYSTEM_PATHS.join('、'));
    process.stdout.write(out.join('\n') + '\n');
    process.exitCode = 0;
    return;
  }
  out.push(`扫了 ${uniqFiles.length} 个文件，命中 ${hits.length} 处：`);
  out.push('');
  let lastHint = null;
  for (const h of hits) {
    out.push(`  ✗ ${h.file}:${h.line}  [${h.ruleName}]  ${h.text}`);
    if (h.hint && h.hint !== lastHint) out.push(`      → ${h.hint}`);
    lastHint = h.hint;
  }
  out.push('');
  out.push(`结论：${hits.length} 处命中 —— 这些路径会在打包时进入发布包，先修掉再打包。`);
  out.push('白名单（不算命中）：' + allowlist.accounts.join('、') + '；' + ALLOWED_SYSTEM_PATHS.join('、'));
  process.stdout.write(out.join('\n') + '\n');
  process.exitCode = 1;
}

main();
