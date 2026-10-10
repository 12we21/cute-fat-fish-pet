/**
 * client 半侧产物 lib/client.js 的发布契约 —— 两道守卫，都是在真实事故里踩过的：
 *
 * ① 注册 id 必须等于包名。DSH 按加载器行的模块说明符解析出包名，再以该包名为键等待
 *    浏览器侧注册这个 bundle；id 不匹配时宿主半侧毫无报错，只是页面里的插件行永远不会
 *    注册（`loaded without registering "<name>" via __ModuleLoader__.load`），Web 半边
 *    静默缺失。2026-10-10 从 dsh-pet 改名成 cute-fat-fish-pet 时漏改过这一处。
 *
 * ② 产物必须整体包在一个 IIFE 里。宿主把同一批插件的 client.js **原样拼接**成一个
 *    classic script（dsh-client-modules buildComboScript：`source += <bundle> + ";\n"`），
 *    所以顶层 const/let/class 与别的插件撞名会造成
 *    `SyntaxError: Identifier 'css' has already been declared`，整批 bundle 一起中止。
 *    修前本 bundle 有 153 个顶层词法声明（css / NS / PIC / pick / sleep / toast …）。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 包内文件（相对本文件所在的 src/src/client/ 解析） */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const pkg = JSON.parse(read('../../package.json')) as { name: string; version: string };
const bundle = read('../../lib/client.js');

/** 去掉空行与整行注释后的代码行 */
const codeLines = bundle
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('//'));

describe('lib/client.js —— 注册 id 必须等于包名', () => {
  test('__ModuleLoader__.load 的字面 id 与 package.json#name 一致', () => {
    const match = bundle.match(/__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/);
    assert.ok(match, 'lib/client.js 里找不到带字面 id 的 __ModuleLoader__.load 调用');
    assert.equal(match![1], pkg.name);
  });

  test('只注册一次（同批 bundle 重复注册同一 id 会被 loader 拒绝）', () => {
    const calls = bundle.match(/__ModuleLoader__\.load\(/g) ?? [];
    assert.equal(calls.length, 1);
  });
});

describe('lib/client.js —— 必须整体包在 IIFE 里（宿主会裸拼接同批 bundle）', () => {
  test('首行代码是 IIFE 开头', () => {
    assert.match(codeLines[0] ?? '', /^;?\s*\(\s*(\(\s*\)\s*=>|function\s*\()/);
  });

  test('末行代码是 IIFE 结束', () => {
    assert.match(codeLines[codeLines.length - 1] ?? '', /^\}\)\(\);?$/);
  });

  test('注册调用在 IIFE 内部（不是顶层）', () => {
    assert.notEqual(codeLines[0], codeLines.find((line) => line.startsWith('window.__ModuleLoader__.load(')));
  });
});

describe('lib/client.js —— 文件形态', () => {
  test('保持 LF、无 BOM（contents API 曾把行尾翻成 CRLF）', () => {
    assert.ok(!bundle.includes('\r'), 'bundle 里出现了 CRLF');
    assert.ok(!bundle.startsWith('\uFEFF'), 'bundle 出现了 UTF-8 BOM');
  });

  test('以换行结尾', () => {
    assert.ok(bundle.endsWith('\n'));
  });
});
