# 发布流程与节奏（维护者规则）

**English summary.** Release rules for this project: one release = a batch of fixes (not one bug = one release); nothing is uploaded before `build/acceptance.py` passes on the exact artifact being shipped; a version number is published once and its assets are never swapped afterwards; security or "core feature is broken for everyone" incidents are the only exception for a same-day patch, and even then the full gate must pass. **This document is in Chinese.**

---

这份文档是为了避免「修一个发一个」把产品发残。2026-10-18 的教训：1.2.2 在一天内从 1.2.1 升上来，发布前只验收了安装与气泡，没验收语音，结果 1.2.2 的 Edge TTS 对所有用户 403（微软换了合成主机），发出去就是坏的。

## 四条硬规则

1. **一次发布 = 一批修复。** 常规版本攒 2–6 周的修复一起发；不允许「改一行就发一版」。
2. **没过闸门不许上传。** 上传用的 exe/zip 必须先在测试目录装好，跑 `python build\acceptance.py --fresh --install-dir <测试安装目录>`，**必须 PASS（13/13）**；任何一项 FAIL 就回到修复，不许「先发再补」。
3. **同一版本号只发一次。** 发布后不替换资产、不改同版本文件（否则用户装到的东西与发布记录对不上，更新器也无法感知）。需要改就升版本号。
4. **事故例外。** 只有「安全 / 数据损坏 / 核心功能对所有人都不可用」才允许当天发补丁版；且必须走完整验收、发布说明里写清「修复了什么事故」、补丁版只包含修复。

## 常规流程（8 步）

0. 修复写进源码，提交到仓库；本地过 `node --check`、`npm run paths` 等门禁。
1. 改版本号：**唯一来源是 `src/package.json`**（根 `package.json`、`launcher/package.json`、`build/installer.nsi` 里的 `APP_VER` 跟着同步）。
2. 写 `docs/release-notes-<版本>.md`：下载表先放 `PENDING_*` 占位。
3. 打包：`npm run build` → `npm run verify` → `npm run check` → `npm run zip` → `npm run exe`。
4. 算 sha256/尺寸，回填发布说明与 `README.md` 的下载表，再提交。
5. **验收闸门**：把 `release\` 里的安装包装到测试目录（或绿色包解压到测试目录），跑
   `python build\acceptance.py --fresh --install-dir <测试安装目录>`，必须 PASS；截图/报告留档。
6. 建 Release：4 个 ASCII 资产 + 不带版本号的别名（`cute-fat-fish-pet-setup.exe` 及 `.sha256`）。
7. 校验：从 GitHub 下载回来核对 sha256；重要版本再用发布版跑一次验收。
8. 归档：`docs/development-log.md` 记条目，事故与已知缺陷记 `docs/known-issues.md`。

## 验收闸门覆盖什么（`build/acceptance.py`）

自动检查（必须 PASS）：

- `install.app_version` / `install.electron` / `install.node`：三块运行时能起来且版本可读。
- `install.speech_models`：SenseVoice 与 Silero VAD 模型在位。
- `install.animations`：动画资源不少于 100 个。
- `install.uninstaller`：`Uninstall.exe` 存在。
- `runtime.health`：桌宠 host 起来，`/health` 正常。
- `runtime.helper_state`：Electron helper 控制面正常（token 鉴权通过）。
- `runtime.bubble`：`/say` → `/broadcast` 台词通道真的更新（气泡链路）。
- `runtime.tts`：`/say` 之后 helper 的 TTS 状态 `last.ts` 更新且 `bytes > 0`（语音链路）。
- `runtime.chat`：对话接口返回非空回复。
- `runtime.screen_watch`（可选）：`点评一下` 能跑出一轮 `lastResult.ok`（本地或在线视觉）。
- `runtime.update_feed`（可选）：GitHub `releases/latest` 的资产命名与别名齐全（更新器可发现）。

**闸门覆盖不到、发布前必须人工过一遍的**（10 分钟）：麦克风语音输入、录屏（OBS / Xbox Game Bar / psr.exe）、右键菜单各项、控制台开关、卸载后重装。

## 发布失败怎么处理

- 产物有问题但还没上传：直接丢掉重打，不占版本号。
- 已上传但发现严重缺陷：**不要替换同版本资产**。修好后升版本号重发，并在 release notes 顶部写「上一版的问题 / 本版修复」。
- 用户已装版本有问题：在发布说明里给出临时处理方式（例如重跑安装包 / 等待下一版），同时把修复排进下一个版本。
