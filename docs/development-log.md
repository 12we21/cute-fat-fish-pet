# Development log

A checkable record of how this project was built. For every milestone: **what the goal was, what changed, how it was verified, and which commit it landed in.**

Everything below is either in this repository (source, scripts, commits) or a published artifact whose hash is listed in the release notes. Nothing here asks you to take my word for it — the "how to check" column and the [verification](#how-to-verify-any-line-in-this-log) section tell you how to reproduce each claim.

[中文摘要见下方](#中文摘要)

---

## Timeline

### 1. Starting point — upstream dsh-pet 0.3.0 (MIT)

| | |
| --- | --- |
| What it is | `dsh-pet` 0.3.0 by **PC2005-cloud** — "A floating desktop pet for the DeepSeek Harness Web UI: idle breathing, occasional direction turns, random actions, and screen wandering" |
| License | MIT, full text preserved as [`assets/LICENSE.txt`](https://github.com/PC2005-cloud/dsh-pet) in this repository |
| Upstream | <https://github.com/PC2005-cloud/dsh-pet> |
| What was imported | The whole package tree, unmodified, into `src/` |

That import is the baseline for everything else. **232 of the 243 files in the published upstream package are still byte-identical**; the 11 that differ are listed one by one, with sizes and reasons, in [differences-from-upstream.md](differences-from-upstream.md).

### 2. Engine work on the imported copy — 2026-10-06 / 10-07

- **Goal**: get the pet to run outside the DSH Web UI, on a bare Windows desktop, and make her usable as a standalone app.
- **Changes**: model selection simplified to a single model per role (`*.bak-before-singlemodel-20261006-190236` is the backup taken then), speech synthesis speed reworked (`*.bak-before-swspeed-20261006-184728`), plus the in-tree changes that later became the released 30 patch entries in `src/lib/index.js`, `src/runtime/electron-helper/{main,sprite,shared-core,events}.js`.
- **Evidence in the repo**: those two backup files were dropped from the published tree (they are the only two files upstream has and this repository does not) — their names carry the dates: `20261006-184728` and `20261006-190236`.
- **Commit**: none — this work happened before the project had its own repository, on the imported copy.

### 3. 2026-10-08 04:03 — 1.0.0: from a plugin to a distributable Windows application

- **Goal**: someone who has never heard of DSH should be able to double-click something and get the pet.
- **Changes**:
  - A standalone runner (`standalone/main.mjs`, `context.mjs`, `server.mjs`) that feeds the unchanged `apply(ctx)` a minimal fake ctx and redirects the three DSH packages to `standalone/shims/`.
  - A single-HTML console (`launcher/`) that starts, stops and configures her.
  - A first-run "local fit": read the GPU's VRAM from the registry, list the models already in Ollama, pick chat/vision models, write `device-profile.json`.
  - A packaging pipeline that lays out a `stage/` tree and produces a portable zip.
- **Verification**: `stage/verify.mjs` self-check (tree fingerprints + a "must not be shipped" list), `check-release` byte-for-byte comparison against the source tree, a zip audit (`714` entries, every non-ASCII name carrying the UTF-8 flag, 15 key files extracted and compared byte for byte), and a full silent install/uninstall acceptance run in an isolated directory.
- **Commit**: `9743b8f` — 可爱大肥鱼桌宠 1.0.0：把 dsh-pet 桌宠做成可分发 Windows 应用

### 4. 2026-10-08 05:46 / 05:52 — the NSIS installer

- **Goal**: no `.cmd` / `.ps1` step for the user; one wizard, no administrator rights.
- **Changes**: `build/installer.nsi` (+ art, icon and the wizard pages), `build/mkexe.py`, the uninstall entry under `HKCU\...\Uninstall\BlueHairMaid`, desktop and start-menu shortcuts.
- **Verification**: silent install into an isolated directory, then a byte-for-byte comparison of all installed files against `stage/`; silent uninstall; then the same again for the GUI path with a screenshot of every wizard page.
- **Commits**: `341f19b` — 加 .exe 安装程序：一路下一步，不用再碰 cmd/ps1; `ab8d89d` — 验收补记：exe 路线的端到端演练脚本 + README

### 5. 2026-10-08 08:08 — 1.0.0 wrap-up

- **Goal**: fix what real use had exposed, and make the package publishable.
- **Changes**: automatic model fitting tuned to fill in chat *and* vision models; "online" mode switched on by filling in an API key and back to "auto" when cleared; vision endpoint and key configurable separately; a direct question always gets an answer first, and a failed model call now says so out loud instead of staying silent; the balance query is only offered when a key exists; the right-click menu and the console drive the same settings; a privacy sweep that removed local paths, deleted the leftover `cli-result.json` and stopped shipping the development `patched/` directory.
- **Verification**: the whole release chain rebuilt and re-verified from scratch: `check-release`, `verify.mjs`, the zip audit, an isolated install/uninstall run, and a byte-for-byte comparison of the installed tree.
- **Commit**: `9a4e73e` — 1.0.0 收尾：8 条体验修正 + 隐私排雷 + 开源 README

### 6. 2026-10-08 08:36 — installer: an upgrade must not install a second copy

- **Goal**: a user who already has the pet installed should not end up with two 761 MB copies.
- **Changes**: `Function .onInit` in `build/installer.nsi` reads `InstallLocation` from the uninstall registry key and reuses that directory when it still contains a working installation; silent installs (`/S`) are left alone so scripts keep control of the target directory.
- **Verification**: the wizard was driven to the directory page with the registry key for the previous installation removed, leaving only the uninstall entry — the page still showed the previous directory (screenshot kept with the release material); the rebuilt installer was then silent-installed into an isolated directory and all installed files were compared byte for byte against `stage/`.
- **Commit**: `a78b3b2` — 安装器：升级认得旧家，不再装出第二份

### 7. 2026-10-08 09:46 — attribution material and a final privacy pass

- **Goal**: before publishing anything, be able to answer "who owns what" in writing.
- **Changes**: `NOTICE.md`; the third-party component list in `assets/第三方声明.txt` extended with the online speech service, online model endpoints and where private data lives; a plain-language privacy section in `assets/使用说明.txt`; the upstream MIT text kept byte-identical and shipped inside the package; `docs/code-signing.zh-CN.md` written; the 1.0.0 artifacts rebuilt so the package contains all of it.
- **Verification**: a secret scan over the whole staged tree (zero hits), a check that the only absolute path left in the package is the `C:\Users\Public` fallback, `verify.mjs` and `check-release` green again, another silent install/uninstall acceptance run with a byte-for-byte comparison.
- **Commit**: `d0351a2` — 开源材料补齐 + 隐私排雷 + 1.0.0 成品重打

### 8. 2026-10-08 12:23 — 1.1.0: a clean standalone source repository

- **Goal**: stop being "an upstream 0.3.0 tree plus a patch script" and become a repository that a stranger can clone, read and build.
- **Changes**:
  - `overlay/` and the patch tooling deleted; the **actual shipped source** now lives in `src/`, with the previously patched files committed in their patched form.
  - `build/build.mjs` rewritten to lay the repository out into `stage/` (`app`, `launcher`, `standalone`, `defaults`, `assets`, `verify`, then the external `electron`, `node`, `speech` blocks); `build/toolchain.mjs` locates those three runtime pieces from an existing installation or from explicit flags, and checks their versions.
  - `build/check-paths.mjs` added as a build gate: no local absolute paths or private directories may enter the repository or the package. The `node.exe` lookup in the speech worker was rewritten to derive from the install layout, and test fixtures were changed to use a placeholder user name.
  - **Control-bridge hardening**: the desktop-side control server now requires a per-installation token (`Authorization: Bearer` / `X-Pet-Token`, constant-time comparison, `0600` token file, fail-closed if it cannot be written), the `Access-Control-Allow-Origin: *` header was replaced by an origin allow-list with `Vary: Origin`, `__proto__` key names are rejected, and `/health` stays unauthenticated but minimal. The standalone HTTP server got the same allow-list, and its `/shutdown` now requires `POST` + token — previously any web page could stop her with a single `<img src="http://127.0.0.1:.../shutdown">`.
  - English-first `README.md` plus `README.zh-CN.md`, [SECURITY.md](../SECURITY.md), [CONTRIBUTING.md](../CONTRIBUTING.md), issue templates, and the docs in this directory.
- **Verification**: `build/build.mjs` (full lay-out), `build/check-release.mjs` (the staged tree matches the repository byte for byte), `build/build.mjs verify` + `stage/verify.mjs` (all four tree fingerprints and 25 individual files), `build/check-paths.mjs` (170 files scanned, clean), the zip audit (714 entries, all non-ASCII names carrying the UTF-8 flag), and a full silent install/uninstall acceptance run: **711 files installed, 710 of them compared byte for byte against `stage/`** (`build/verify-install.py`), data root untouched, uninstall clean.
- **Commit**: `82411e7` — 1.1.0：干净的独立仓库 + 控制口鉴权 + 隐私路径门禁 + 独立构建链

### 9. 2026-10-08 12:52 — artifact file names are ASCII

- **Goal**: the published file names must survive GitHub Releases.
- **Finding**: GitHub **deletes** non-ASCII characters from release asset names — an uploaded `可爱大肥鱼桌宠-1.1.0-安装程序.exe` appears as `-1.1.0-.exe`, and renaming it back through the API is sanitized in exactly the same way. ASCII renames through the API work.
- **Changes**: `build/mkexe.py`, `build/mkzip.py`, `build/checkzip.py`, `build/installer.nsi`, `assets/使用说明.txt` and the docs now use `cute-fat-fish-pet-<version>-setup.exe` and `cute-fat-fish-pet-<version>-win-x64.zip`; the 1.1.0 artifacts were rebuilt, re-verified and re-uploaded under the ASCII names.
- **Commit**: `325b460` — 产物文件名一律 ASCII：GitHub 会删掉资产名里的非 ASCII

### 10. 2026-10-08 12:31 / 12:34 UTC — first public release

- The repository was created as a public repository and the first push landed (`git rev-list --left-right --count origin/main...main` → `0 0`).
- Release **v1.1.0** was published with the two artifacts and their two `.sha256` files.

### 11. 2026-10-08 21:4x — 1.1.1: a double-click really installs, and really uninstalls

- **Goal** (a direct request): anyone who downloads the zip, unpacks it and double-clicks `安装.cmd` should end up with a working installation on the first try — and uninstalling must not leave debris behind.
- **Root causes** (three old, one new — full write-ups in [known-issues.md](known-issues.md)):
  - KI-1: when `install.ps1` was missing (the "double-clicked inside the zip preview" case) Windows PowerShell printed an error and exited **0**, so the old wrapper's `if errorlevel 1` never paused and the window vanished without a word.
  - KI-2: the portable installer still wrote the old product name and version `1.0.0` into the shortcut and the uninstall entry.
  - KI-3: Chinese text in a UTF-8 `.cmd` plus `chcp 65001` made `cmd.exe` mis-parse the following lines (`'onPolicy' is not recognized …`).
  - KI-5 (found by testing this release): the uninstaller ran **from inside the directory it was deleting** — `cmd.exe`'s CWD was the install dir and it was reading `卸载.cmd` itself — so `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue` failed as a whole, silently, leaving all 714 files.
- **Changes**:
  - `assets\安装.cmd` 285 B → **3,941 B**, `assets\卸载.cmd` 1,086 B → **1,298 B**: pure ASCII / no BOM / LF; they check for the files they need before doing anything, print the Chinese explanation through `powershell -EncodedCommand` (code-page independent), always `pause`, and the uninstall wrapper parks its working directory in `%TEMP%` instead of the install folder.
  - `assets\install.ps1` 9,284 B → **11,085 B**: `$DisplayName = "可爱大肥鱼桌宠"` (same string as the NSIS `APP_NAME`), `$Version` read from the packaged `app\package.json`, `Publisher` shared with `APP_PUB`, legacy 「蓝毛小女仆」 shortcuts migrated to `.lnk.bak-<timestamp>` instead of leaving two icons.
  - `assets\uninstall.ps1` 5,221 B → **8,191 B**: handles both product names, deletes everything except the `.cmd` files that are still open (deleting the running batch file breaks the rest of the batch), and hands the leftovers to a detached hidden PowerShell helper that waits for the window to close and retries for up to ~2 minutes.
  - Version 1.1.1 in the four `package.json` files and in the `!define APP_VER` default of `build/installer.nsi`; `src/README.md` no longer names a version so future releases do not have to touch a packaged file.
- **Verification**: real acceptance run on the shipped zip — unpack (714 entries) → run `安装.cmd` (10.2 s, English header + correct Chinese messages + `[ok] Setup finished.`) → `python build\verify-install.py stage <dir>`: **710 of 710 files byte-identical (797,834,384 B)** → registry `DisplayName=可爱大肥鱼桌宠`, `DisplayVersion=1.1.1`, `UninstallString` → that directory's `卸载.cmd` → run that uninstaller: shortcuts and uninstall entry removed, user data kept, **the install directory was gone two seconds after the window closed**. Gates all green: `build\check-release.mjs`, `build\nsi-syntax-check.py`, `build\mkzip.py`, `build\mkexe.py`, and the packaged `verify.mjs`.
- **Commit**: `9633b0c` — 1.1.1：绿色包双击即装、卸载不留残骸

### 12. 2026-10-09 — 1.1.2: the online model stops thinking out loud

- **Goal** (a direct report): she was saying her whole thinking process out loud in chat — with the online model configured and the brain on 「在线（联网模型）」 or 「自动择优」.
- **Two root causes found while investigating** (full write-up: [KI-6](known-issues.md)):
  - The saved `standalone\online.json` said `model: "DeepSeek-chat"`, while that endpoint serves `deepseek-flash` and `deepseek-v4-pro`; the capitalised name comes back as **HTTP 400** (the lowercase `deepseek-chat` is still accepted and answered by `deepseek-flash`). As saved, the online path was effectively unusable.
  - Those models are *thinking* models. With the pet's short budget (20–40 characters) the measured result was **0 characters of `content` and 556 characters of `reasoning_content`**, and `standalone/online.mjs` fell back to speaking the reasoning. `"enable_thinking": false` is not a real switch (still 21 tokens of thinking); `"thinking": {"type": "disabled"}` and `"reasoning_effort": "none"` are.
- **Changes** — `standalone/online.mjs` 12,661 B → **14,228 B**, three edits:
  1. `thinkingOff(baseUrl, model)` adds `"thinking": {"type": "disabled"}` for `api.deepseek.com` (never for `reasoner` models; other OpenAI-compatible endpoints are left untouched so no server rejects an unknown field).
  2. A response that has reasoning but no content now returns `{ok: false, reason: "thinking-only"}` with 「联网模型只想了、没写正文：把预算调大，或在控制台换一个不思考的模型」 instead of narrating the reasoning — the policy the local path already followed (`src/lib/index.js:431`, the helper's `pet:local-quip`).
  3. `toOpenAIMessages` now accepts a plain-string `content`; before, an array-only reader turned a string into an **empty prompt** and the model answered something unrelated.
  - Version 1.1.2 in the four `package.json` files and the `!define APP_VER` default of `build/installer.nsi`; `docs/release-notes-1.1.2.md` added, [known-issues.md](known-issues.md) gained KI-6.
- **Verification**: `node --check`; real calls through the patched module — `onlinePing` → 「在的」; a persona with array-shaped content → 「主人早安呀～今天也要元气满满哦！✨」; a plain-string message → 「你真是独一无二的闪光存在！」. The same one-liner went from 400 tokens burned on thinking to **2 tokens**. Separately confirmed that `deepseek-flash` really reads images (a synthetic card came back as `FISH 42`), so the console's hint that it is a vision model is accurate.
- **Commit**: ``dba4e2d`` — 1.1.2：联网模型不再把思考当台词

---

## How to verify any line in this log

```powershell
git log --oneline                 # the commit list quoted above
node build\build.mjs --toolchain <an installed Cute Fat Fish Pet directory>   # lay out stage\
node build\check-release.mjs     # stage\ must match this repository byte for byte
node build\check-paths.mjs       # no local paths / private directories anywhere
node stage\verify.mjs            # tree fingerprints + the "must not be shipped" list
```

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.0-setup.exe -Algorithm SHA256   # compare with the release notes
```

Then reproduce the acceptance run: install the setup silently into a scratch directory (`setup.exe /S /D=<scratch>`), run `python build\verify-install.py stage <scratch>` and compare the numbers with [step 8](#8-2026-10-08-1223--110-a-clean-standalone-source-repository). Note that installing writes to `HKCU` (the uninstall entry and the desktop shortcut): on a machine that already has the pet installed, export `HKCU\Software\BlueHairMaid` and `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid` first and restore them afterwards.

## What this log does *not* claim

- No commit history from before 2026-10-08 exists: the project only got its own repository that day. Work done earlier is documented by the file-level evidence described in step 2, not by commits.
- The upstream project is **not** claimed as this project's work: it is MIT-licensed code by PC2005-cloud, kept in-tree with attribution intact, and the exact per-file differences are published.
- No claim is made that the 12 modified files are all "improvements" — the list, with sizes and hashes, is published so anyone can review them.

---

## 中文摘要

这份日志记录每一步的**目标 → 改动 → 验证 → 提交**，全部可自行核对：提交用 `git log`，验证用仓库里的 `build\check-release.mjs`、`verify.mjs`、`build\check-paths.mjs`、`build\verify-install.py`。

- **起点**：上游 **dsh-pet 0.3.0**（PC2005-cloud，MIT），整树导入 `src/`；发布包 243 个文件里 **232 个至今逐字节未改**，11 个刻意修改（每个都有大小与原因，见 [differences-from-upstream.md](differences-from-upstream.md)），没有删掉上游任何文件，另有 2 个引擎文件（`obs-ctl.js`、`stt-worker.mjs`）是本项目新增。
- **2026-10-06 / 10-07**：让桌宠脱离 DSH Web UI 在普通 Windows 桌面上跑起来（单一模型 / 语速等改动；当时的两个 `*.bak-before-*` 备份文件名就是日期证据，它们已不在发布树里）。
- **2026-10-08 04:03（`9743b8f`）**：1.0.0 —— 独立运行器、单 HTML 控制台、首次运行自动适配、绿色 zip 打包。
- **05:46 / 05:52（`341f19b`、`ab8d89d`）**：NSIS 安装程序，免管理员、一路下一步。
- **08:08（`9a4e73e`）**：1.0.0 收尾 —— 自动适配补齐聊天与视觉模型、填 Key 自动切在线、视觉可单独配、问话优先回、余额查询、菜单与控制台联动、隐私排雷（删 `cli-result.json`、不再发 `patched\`）。
- **08:36（`a78b3b2`）**：安装器升级认得旧家，不再装出第二份。
- **09:46（`d0351a2`）**：署名与第三方材料补齐 + 隐私再排一遍 + 1.0.0 成品重打。
- **12:23（`82411e7`）**：1.1.0 —— 删掉 overlay/补丁机制、`src/` 即成品源码、独立构建链（`build.mjs` + `toolchain.mjs`）、隐私路径门禁 `check-paths.mjs`、**控制口鉴权与来源白名单**（含 `/shutdown` 必须 POST + token）、英文优先的 README 与安全/贡献文档。
- **12:52（`325b460`）**：产物名一律 ASCII（GitHub 会删掉资产名里的非 ASCII 字符）。
- **12:31 / 12:34 UTC**：仓库公开发布，Release **v1.1.0** 上线（两个成品 + 两个 `.sha256`）。
- **21:4x（`9633b0c`）**：1.1.1 —— 绿色包「解压 → 双击 `安装.cmd`」第一次就能装成功：修好闪退（KI-1）、装出来的名字/版本（KI-2）、`.cmd` 里的中文导致解析错乱（KI-3），并修掉测试中新发现的「卸载后安装目录整个还在」（KI-5，卸载器自己就在被删的目录里跑）。四个脚本全部重写/加固，包内 `README` 不再写死版本号。

装好之后的验收数字：静默安装 **711 个文件**，其中 **710 个与 `stage/` 逐字节一致**（`build\verify-install.py`），数据根未被改动，卸载干净。
1.1.1 的绿色包另外真跑了一遍「解压 → `安装.cmd` → 卸载」：装出来 **710/710 逐字节一致**、登记项版本 **1.1.1**、卸载后 **安装目录在窗口关闭后 2 秒内被完整清掉**。
- **2026-10-09（``dba4e2d``）**：1.1.2 —— 联网模型不再把「思考过程」整段当台词念出来（KI-6）：DeepSeek 现在的模型都是思考型，桌宠的短预算下正文为空、思考一大段（实测 20 token → 正文 0 字 / 思考 556 字），而 `online.mjs` 退而把 reasoning 当回答；改为对 DeepSeek 端点直接发 `thinking:{"type":"disabled"}`（同一句话 400 token → **2 token**），并把「只想了、没写正文」改成如实报错，**绝不念思考**；顺带修掉「保存的模型名大小写写错导致 HTTP 400」与「字符串形状的消息被静默变成空 prompt」。
1.1.2 的验收：绿色包「解压 → `安装.cmd` → 卸载」与安装器静默安装各自逐字节一致，数字见 [known-issues.md](known-issues.md) 的「修复验证」。
