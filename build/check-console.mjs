/**
 * 控制台单页体检（overlay\launcher\index.html）：
 *   1) 把每个 <script> 块拿出来做语法检查（node --check 等价，用 vm.Script）
 *   2) 页面里所有 $("xxx") / getElementById("xxx") 引用的 id 必须真的存在
 *   3) 不能有重复 id
 * 用法：node build\check-console.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "overlay", "launcher", "index.html");

const html = fs.readFileSync(FILE, "utf8");
let fail = 0;
const bad = (m) => { console.log("  [FAIL] " + m); fail++; };
const ok = (m) => console.log("  [ ok ] " + m);

// ---- 1) 脚本语法 ----
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
if (!blocks.length) bad("没找到 <script> 块");
blocks.forEach((code, i) => {
  try {
    new vm.Script(code, { filename: `index.html#script${i + 1}` });
    ok(`脚本 #${i + 1} 语法通过（${code.length} 字符）`);
  } catch (e) {
    bad(`脚本 #${i + 1} 语法错误：${e.message}`);
  }
});

// ---- 2) id 引用 ----
const defined = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
  if (defined.has(m[1])) bad(`id 重复：${m[1]}`);
  defined.add(m[1]);
}
ok(`页面里定义了 ${defined.size} 个 id`);

const used = new Set();
for (const m of html.matchAll(/\$\("([^"]+)"\)/g)) used.add(m[1]);
for (const m of html.matchAll(/getElementById\("([^"]+)"\)/g)) used.add(m[1]);
const missing = [...used].filter((id) => !defined.has(id)).sort();
if (missing.length) bad("引用了不存在的 id：" + missing.join(", "));
else ok(`脚本引用的 ${used.size} 个 id 全都在页面里`);

// ---- 3) 大小 / 折叠区统计（顺手报告，方便对照） ----
const details = (html.match(/<details/g) || []).length;
console.log(`  [info] 文件 ${fs.statSync(FILE).size} B，${html.split("\n").length} 行，${details} 个折叠区`);
console.log(fail ? `\n结论：有 ${fail} 处问题` : "\n结论：全部通过");
process.exit(fail ? 1 : 0);
