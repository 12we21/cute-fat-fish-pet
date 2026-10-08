/**
 * selftest-tts-pitch.mjs —— 验证补丁 T2 的音高读取真的按规则走
 * ---------------------------------------------------------------------------
 * 做法：把 stage\app\runtime\electron-helper\main.js 里那个 ttsPitchFromConfig()
 *       原样抠出来，塞进一个临时 .cjs（这样 require 在作用域里），
 *       换着 DSH_HOME 下的 tts-pitch.txt 跑一遍用例，比对期望值。
 * 用法：node build\selftest-tts-pitch.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE = process.env.DSH_PET_STAGE || path.join(path.dirname(HERE), "stage");
const HELPER = path.join(STAGE, "app", "runtime", "electron-helper", "main.js");

const src = fs.readFileSync(HELPER, "utf8");
const start = src.indexOf("function ttsPitchFromConfig()");
const end = src.indexOf("function ttsBuildSsml(");
if (start < 0 || end < 0 || end < start) {
  console.error("✗ 在 stage 的 helper main.js 里找不到 ttsPitchFromConfig —— 补丁 T2 没打上？");
  process.exit(1);
}
const fn = src.slice(start, end).trimEnd();

// 再抠两段：转义函数 + SSML 拼装函数（证明音高真的被写进发出去的 SSML）
const escStart = src.indexOf("function ttsSsmlEscape(");
const escEnd = src.indexOf("function ttsBuildSsml(");
const ssmlStart = src.indexOf("function ttsBuildSsml(");
const ssmlEnd = src.indexOf("function ttsConnect(");
if (escStart < 0 || escEnd < 0 || ssmlStart < 0 || ssmlEnd < 0) {
  console.error("✗ 在 stage 的 helper main.js 里找不到 ttsSsmlEscape / ttsBuildSsml / ttsConnect —— 蓝本结构变了？");
  process.exit(1);
}
const escFn = src.slice(escStart, escEnd).trimEnd();
const ssmlFn = src.slice(ssmlStart, ssmlEnd).trimEnd();

const CASES = [
  { text: "+35Hz\n", want: "+35Hz", why: "正常值" },
  { text: "35Hz\n", want: "+35Hz", why: "没写正号也要认" },
  { text: "-20Hz", want: "-20Hz", why: "负值（更低沉）" },
  { text: "+80Hz", want: "+80Hz", why: "上界" },
  { text: "+81Hz", want: "+0Hz", why: "超过上界回落" },
  { text: "+1000Hz", want: "+0Hz", why: "三位数以上直接不认" },
  { text: "abc", want: "+0Hz", why: "胡写回落" },
  { text: "+35hz", want: "+0Hz", why: "大小写不对回落" },
  { text: "", want: "+0Hz", why: "空文件回落" },
  { text: null, want: "+0Hz", why: "文件不存在回落" },
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "pitchtest-"));
const runner = path.join(work, "run.cjs");
fs.writeFileSync(
  runner,
  [
    "const path = require('node:path');",
    "const fs = require('node:fs');",
    fn,
    escFn,
    ssmlFn,
    "const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));",
    "const out = [];",
    "for (const c of cases) {",
    "  const home = path.join(__dirname, 'home-' + out.length);",
    "  fs.mkdirSync(path.join(home, 'dsh-pet'), { recursive: true });",
    "  if (c.text !== null) fs.writeFileSync(path.join(home, 'dsh-pet', 'tts-pitch.txt'), c.text, 'utf8');",
    "  process.env.DSH_HOME = home;",
    "  out.push(ttsPitchFromConfig());",
    "}",
    "const ssml = {",
    "  withPitch: ttsBuildSsml('你好<&>', 'zh-CN-XiaoxiaoNeural', '-15%', '+45Hz'),",
    "  noPitch: ttsBuildSsml('你好', 'zh-CN-XiaoxiaoNeural', '-15%'),",
    "  emptyPitch: ttsBuildSsml('你好', 'zh-CN-XiaoxiaoNeural', '-15%', ''),",
    "};",
    "process.stdout.write(JSON.stringify({ pitch: out, ssml }));",
    "",
  ].join("\n"),
  "utf8",
);
fs.writeFileSync(path.join(work, "cases.json"), JSON.stringify(CASES), "utf8");

const r = spawnSync(process.execPath, [runner], { encoding: "utf8" });
if (r.status !== 0) {
  console.error("✗ 跑不起来：", r.stderr || r.stdout);
  process.exit(1);
}
const got = JSON.parse(r.stdout).pitch;
let bad = 0;
console.log("音高读取自检（<DSH_HOME>\\dsh-pet\\tts-pitch.txt）");
CASES.forEach((c, i) => {
  const ok = got[i] === c.want;
  if (!ok) bad++;
  const shown = c.text === null ? "(没有文件)" : JSON.stringify(c.text);
  console.log(`  ${ok ? "OK   " : "✗ 错 "} ${shown.padEnd(12)} → ${got[i].padEnd(7)} 期望 ${c.want.padEnd(7)} ${c.why}`);
});

// SSML 拼装：音高必须真的写进发出去的那段 SSML
const ssml = JSON.parse(r.stdout).ssml;
const SSML_CASES = [
  { name: "带音高 +45Hz", body: ssml.withPitch, want: "pitch='+45Hz' rate='-15%'", why: "音高进了 prosody" },
  { name: "没传音高", body: ssml.noPitch, want: "pitch='+0Hz'", why: "回落 +0Hz" },
  { name: "音高传空串", body: ssml.emptyPitch, want: "pitch='+0Hz'", why: "空串也回落" },
  { name: "文本转义", body: ssml.withPitch, want: "你好&lt;&amp;&gt;", why: "< & > 被转义" },
];
console.log("\nSSML 拼装自检（证明音高真的发给合成引擎）");
for (const c of SSML_CASES) {
  const ok = String(c.body).includes(c.want);
  if (!ok) bad++;
  console.log(`  ${ok ? "OK   " : "✗ 错 "} ${c.name.padEnd(12)} ${c.why}${ok ? "" : ` ← 期望含 ${c.want}`}`);
}
console.log("  样例：" + ssml.withPitch);
fs.rmSync(work, { recursive: true, force: true });
console.log(bad ? `\n结果：${bad} 个用例不符` : `\n结果：${CASES.length} 个用例全对`);
process.exit(bad ? 1 : 0);
