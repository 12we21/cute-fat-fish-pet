/**
 * 路径规则自测（改 paths.js / paths.mjs 之后跑一下）
 *   node build\selftest-paths.cjs
 * 覆盖：默认 %APPDATA% / portable.txt / data-root.txt（绝对、相对、带注释）/ 环境变量优先
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePaths } = require("..\\overlay\\launcher\\paths.js");

const root = path.join(os.tmpdir(), "dshpet-pathstest");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, "launcher"), { recursive: true });

let bad = 0;
const show = (label, expectSource, expectTail) => {
  const p = resolvePaths(path.join(root, "launcher"));
  const okSource = p.dataRootSource === expectSource;
  const okTail = !expectTail || p.userRoot.toLowerCase().endsWith(expectTail.toLowerCase());
  if (!okSource || !okTail) bad++;
  console.log(
    `  ${okSource && okTail ? "[ok]" : "[x ]"} ${label.padEnd(26)} source=${p.dataRootSource.padEnd(8)} userRoot=${p.userRoot}`,
  );
};

delete process.env.DSH_PET_DATA_DIR;
show("默认（%APPDATA%）", "appdata", path.join("BlueHairMaid"));

fs.writeFileSync(path.join(root, "portable.txt"), "");
show("有 portable.txt", "portable", path.join("userdata"));

fs.writeFileSync(path.join(root, "data-root.txt"), "# 注释行会被跳过\n" + path.join(root, "mydata") + "\n");
show("data-root.txt 绝对路径", "file", path.join("mydata"));

fs.writeFileSync(path.join(root, "data-root.txt"), "..\\sibling\\data\n");
show("data-root.txt 相对路径", "file", path.join("sibling", "data"));

process.env.DSH_PET_DATA_DIR = path.join(root, "envdir");
show("环境变量优先", "env", path.join("envdir"));

fs.rmSync(root, { recursive: true, force: true });
console.log(bad === 0 ? "\n  全部通过 ✓" : `\n  ${bad} 项不符合预期 ✗`);
process.exit(bad === 0 ? 0 : 1);
