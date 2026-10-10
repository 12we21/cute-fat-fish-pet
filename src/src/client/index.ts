// client 半侧 bundle 外壳：由 tsdown 构建为 lib/client.js。
// 必须是一个「普通副作用脚本」——加载时调用 window.__ModuleLoader__.load，
// 不能包含顶层 ESM export / import（react 由 factory 的 require 取得）。
import { makeFactory } from './app';

declare const window: {
  __ModuleLoader__: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 全局注入的模块系统契约（f(require) => module）
    load(info: { id: string; factory: (require: (m: string) => any) => any }): void;
  };
};

// 注册 id 必须是**本包名**（D:\deeps 侧 dsh-client-modules 的规则）：DSH 会按
// 加载器行的模块说明符解析出包名，再以该包名为键等待浏览器侧注册这个 bundle；
// id 不匹配时宿主半侧不报错，但页面里的插件行永远不会注册（"loaded without
// registering ... via __ModuleLoader__.load"），Web 半边静默缺失。
// 2026-10-10 改名（dsh-pet → cute-fat-fish-pet）时这里漏改，已修正（浏览器侧因此一直没注册）。
window.__ModuleLoader__.load({
  id: 'cute-fat-fish-pet',
  factory: makeFactory(),
});
