/**
 * 共用的小工具：哪些文件不该进发布包、怎么遍历一棵树。
 * build.mjs（铺 stage）和 check-release.mjs（对账）都用这一份，免得两处规则跑偏。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** 绝对不该进包的东西：开发期草稿、运行期状态、私人数据 */
export const NEVER = [
  /(^|\/)\.git($|\/)/,
  /(^|\/)__pycache__($|\/)/,
  /(^|\/)node_modules\/\.cache($|\/)/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/,
  /\.log$/,
  /\.bak($|-)/, // 补丁期留下的 index.js.bak-before-xxx 之类
  /~$/,
  /\.tmp$/,
  /(^|\/)runtime\.json$/, // 上一只桌宠的 pid/端口
  /(^|\/)online\.json$/, // 联网模型设置（可能含 API Key）
  /(^|\/)pet-control\.json$/, // 「允许动手」的授权状态
  /(^|\/)helper-control\.json$/, // 控制桥的端口/token
  /(^|\/)device-profile\.json$/, // 本机显卡/模型探测结果
  /(^|\/)cli-result\.json$/, // 控制台跑完留下的记录（含本机绝对路径）
  /(^|\/)userdata($|\/)/, // Electron 的用户数据
  /^patched($|\/)/, // 老发布仓的开发期草稿堆（这里只是留个保险）
];

export const never = (rel) => NEVER.some((re) => re.test(String(rel).split(path.sep).join("/")));

/** 列出一棵树里的所有文件（相对路径 + 大小），按路径排序 */
export function walkFiles(root, { filter = never } = {}) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, p);
      if (filter && filter(rel)) continue;
      out.push({ abs: p, rel: rel.split(path.sep).join("/"), size: fs.statSync(p).size });
    }
  })(root);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

export function sha256File(p, buf = 1 << 20) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const b = Buffer.allocUnsafe(buf);
    for (;;) {
      const n = fs.readSync(fd, b, 0, buf, null);
      if (!n) break;
      h.update(b.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** 整树指纹：把「相对路径 + 文件内容 sha」按路径排序后聚合，一个改动就变 */
export function treeFingerprint(root, { filter = never } = {}) {
  const h = crypto.createHash("sha256");
  let files = 0;
  let bytes = 0;
  for (const f of walkFiles(root, { filter })) {
    h.update(f.rel);
    h.update("\0");
    h.update(sha256File(f.abs));
    h.update("\n");
    files++;
    bytes += f.size;
  }
  return { files, bytes, treeSha256: h.digest("hex") };
}
