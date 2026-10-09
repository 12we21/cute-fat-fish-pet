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

### 13. 2026-10-09 — 1.1.3: 「打开 X」 reaches a website, a folder or a file

- **Goal** (a direct request): in voice mode she had to understand and carry out 「打开xx游戏 / 打开A站首页 / 打开XX文件夹」 — an app, a URL or a file — and everything else had to be self-checked afterwards, with any bug found fixed.
- **Reconnaissance**: the spoken and the typed command go through **one** function — `src/runtime/electron-helper/sprite.js` `onChatSendIntercept` (voice enters via `voiceRouteText` → `voiceTryIntent`). It had exactly two buckets, `isUrl(…) ? 'url' : 'app'`, where `isUrl` accepted only `^https?://`, `www.` or a small TLD list; and the main process (`ipcMain.handle('pet:open-target')`) had **no** branch for a local folder or file either. So 「打开 A站首页」, 「打开 下载文件夹」 and 「打开 报告.docx」 never got past parsing. No test file existed for any of it.
- **Changes**:
  - New `src/runtime/electron-helper/targets.js` (**9,430 B**, plain logic, no Electron API): `classify(text)` → `url` / `file` / `app` in that priority (URL → local path → drive letter → system-folder token → site alias → app fallback), plus `siteUrl` / `folderToken` / `driveRoot` / `looksLikePath` / `searchUrl`. The site list is curated; `steam` and 音乐 are deliberately **not** in it, so 「打开蒸汽」 keeps starting the app and 「打开音乐」 keeps opening the music program instead of a folder.
  - `sprite.js` 245,629 B → **250,704 B**: `normOpenText()` (strips sentence-final particles and a leading 请/麻烦/劳驾, rewrites 「帮我把 B站 打开」 into 「打开 B站」) and `parseSearchIntent()` (「百度一下 / 搜一下 / 查一下 X」 → the result page, Bing by default, Baidu when named); `parseIntent`'s existing regex was left **byte-for-byte unchanged** so the already-working spoken forms could not break; the parsed target goes through `classify` and then through the matching `this.perm[kind]` gate; `execOpen` gained the `file` branch (opened / `ambiguous` → ask, do not guess / `not-found` → say so).
  - `main.js` 133,674 B → **138,421 B**: `pet:open-target` gained `kind: 'file'` → `openLocalTarget()` — a folder token resolves through `app.getPath()`, a drive letter or absolute path through `fs.existsSync` + `shell.openPath`, and a bare name through a read-only `readdirSync` of the **top level** of 桌面 / 下载 / 文档 / 图片 / 视频 / 音乐, **skipping `.lnk/.url/.exe/.bat/.cmd`** (those are apps: the file permission must never be able to launch software by accident). More than one hit asks instead of guessing. Nothing is ever deleted, moved, renamed or written.
  - `index.html` loads `targets.js` between `constants.js` and `sprite.js`; version 1.1.3 in the four `package.json` files and the `!define APP_VER` default of `build/installer.nsi`; `build/check-release.mjs` now pins `app/runtime/electron-helper/targets.js` as a key file; `docs/release-notes-1.1.3.md` added and [known-issues.md](known-issues.md) gained KI-7.
- **Verification**: offline, `_accept/test-voice-targets.cjs` — **72 of 72** assertions (31 classification cases including 「打开音乐」/「打开steam」 regressions, 16 routing cases, ordinary chat not intercepted, each of the three permission switches blocking/allowing, recording priority, the ask/found/not-found replies, and `openLocalTarget` against a real temporary directory). In a real Electron renderer over CDP, `_accept/run-voice-live.cjs` + `_accept/test-voice-live.cjs` — **21 of 21**, including the real main process opening the Downloads folder and `%TEMP%` and answering `not-found` for a nonsense name. The packaged smoke self-test (drag, click-through, menus, animation webm, `errors: []`) found one **stale false negative of its own**: it checked the context menu immediately after the event, while the menu is built after two `await`s (`fetchWatchState` ≤2.5 s, `textModelMenuInfo` ≤1.2 s); it now polls, and reports `menuMounted: true, waitedMs: 200, panelCount: 35`. A 1.1.2 baseline run showed everything else identical, so the change introduced no regression. Gates: privacy scan (182 files clean), `check-release` (byte-for-byte), `--emit --write`, `stage/verify.mjs` (4 tree fingerprints + 26 key files), `mkzip`, `mkexe`.
- **Commit**: `bd0ebd1` — 1.1.3：语音/打字说「打开 X」能开网页、文件夹和文件

### 14. 2026-10-09 — 1.1.4: the console answers to a click instead of showing an API key

- **Goal** (a direct request): before recording a promo video, she asked that sensitive things in the console — 「API key」 above all — be hideable, because they would end up on camera. Her second message the same day set the scope: 「我只需要能主动隐藏 API key 的功能，不要加录制什么的」 — only an active hide, no recording mode.
- **Reconnaissance**: only two places ever showed a key — `launcher/index.html:163` `#onlineKey` and `:167` `#onlineVisionKey`, both `type="text"`. The plaintext travels `launcher/pet-api.js:35` `ONLINE_FILE = path.join(PATHS.standaloneDir, "online.json")` → `readOnline()` (`launcher/pet-api.js:230-242`, returns the raw key plus `hasKey/hasVisionKey/visionReady`) → `launcher/main.js:387` / `:415-427` `doOptions()` → the renderer's `syncForm` (`launcher/index.html:581`). Everything printed went through `log()` (`index.html:693-705`), `setupLine()` (`:712-720`), `#permLog` and the footer `#footRoot` / `#footData` — all of them `textContent = 原文`.
- **Changes** (one file, `launcher/index.html`):
  - CSS: new `.eye` for the small 显示 / 隐藏 buttons, and the base input selector extended to `select, input[type=text], input[type=number], input[type=password]` — otherwise a password field would have no style and no `flex: 1`. The 「typed something ⇒ dirty」 selector at the bottom gained `input[type=password]` too.
  - Both key fields became `type="password"` (`autocomplete="off" spellcheck="false"`) with one `.eye` button each: the field shows dots by default and **she** decides when to look, either key independently.
  - New privacy block, `secretValues()` + `maskSecrets(text)`: the saved key becomes `••••••`, then `sk-[A-Za-z0-9_\-]{4,}` → `sk-••••••` and `(Bearer\s+)[A-Za-z0-9._\-]{6,}` → `$1••••••`; anything else is passed through untouched, and the function is idempotent. `applySecretVisibility()` flips `el.type` between `password` and `text` and keeps the button label (显示 / 隐藏) in sync.
  - `log()`, `setupLine()`, `#permLog` and the footer put `maskSecrets(text)` on the screen, so a key never lands in the terminal by accident.
  - A recording-mode switch (checkbox + `● 录制中` badge + `localStorage` + repainting old lines from `dataset.raw`) was written first and **removed the same day at her request**; nothing of it is left in the page.
- **Verification**: in a real Electron renderer over CDP, `_accept/test-console-privacy.cjs` — **26 of 26** assertions: both fields start as dots while their `.value` is the real key (the whole `online.json` → `doOptions` → `syncForm` path proven); 显示 turns exactly that field to plain text, the button becomes 隐藏, the value does not change, the other field stays dotted; the page contains no `#privacyMode`, no `#privacyBadge`, no `body.privacy` class and no `localStorage` key; with the key on screen, keys, `sk-…` and `Bearer …` tokens are masked in the terminal, the setup log, the permission log and the footer; ordinary paths (`C:\Users\…\AppData\Roaming\BlueHairMaid`) and plain text pass through unchanged. The run used an isolated instance (temporary `DSH_PET_DATA_DIR`) and deleted its temporary `standalone\online.json` afterwards. Offline, the inline script extracted to `_accept/console-inline.js` (54,433 characters) passes `node --check`.
- **Also**: KI-8 in [known-issues.md](known-issues.md); `docs/release-notes-1.1.4.md` (EN + Chinese) added and linked from both front pages; version 1.1.4 in the four `package.json` files, the `!define APP_VER` default of `build/installer.nsi`, `NOTICE.md`, both READMEs and the maintainer notes. The privacy gate then caught the new release notes themselves (2 hits) for quoting a literal local path as a counter-example — rewritten the way the other documents do it; the gate now scans 184 files clean. Removing the recording mode meant rebuilding both artifacts and refreshing their sizes and hashes in the documents.
- **Acceptance**: both published artifacts were installed and uninstalled for real — the installer (52 s, 712 files, 711 of them byte-identical, `DisplayVersion=1.1.4`, data root untouched, uninstall 2 s) and the portable zip (extract 13 s, tree `verify.mjs` exit 0, `安装.cmd` 2.9 s, the same 711 files byte-identical, uninstall 4.3 s) — and her own 1.1.3 install was upgraded in place (55 s, 718 files, 711 of them byte-identical, `DisplayVersion` 1.1.4) and her pet restarted (4 `electron.exe`, `launcher/index.html` matching `stage/` byte-for-byte). Numbers in [known-issues.md](known-issues.md), 「1.1.4 的验收」.
- **Commit**: `__COMMIT__` — 1.1.4：控制台可以折叠 / 隐藏 API Key

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

- **起点**：上游 **dsh-pet 0.3.0**（PC2005-cloud，MIT），整树导入 `src/`；发布包 243 个文件里 **232 个至今逐字节未改**，11 个刻意修改（每个都有大小与原因，见 [differences-from-upstream.md](differences-from-upstream.md)），没有删掉上游任何文件，另有 3 个引擎文件（`obs-ctl.js`、`stt-worker.mjs`、`targets.js`）是本项目新增。
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
- **2026-10-09（`bd0ebd1`）**：1.1.3 —— 「打开 X」能开三种东西（KI-7）：以前桌宠只认网址和软件（`isUrl() ? 'url' : 'app'` 两个桶），说「打开 A站首页」没反应、「打开 下载文件夹」「打开 报告.docx」会被当软件名去找；新增纯逻辑文件 `targets.js`（网址 → 本机路径 → 盘符 → 系统文件夹 → 站点别名 → 软件兜底），`sprite.js` 新增语气词归一与「搜一下/百度一下」，`main.js` 新增 `kind:'file'` 的 `openLocalTarget()`（只读、只开、跳过 `.lnk/.exe` 这类软件、重名只问不做），并给它单独一个权限开关「允许她打开文件夹/文件」（默认关）；语音与打字共用同一个函数。
1.1.3 的验收：离线回归 **72/72**、真渲染端 CDP **21/21**（含真主进程开窗）、包内自检全过（顺带修掉自检对右键菜单的假阴性），数字见 [known-issues.md](known-issues.md) 的「1.1.3 的验收」。
- **2026-10-09（`__COMMIT__`）**：1.1.4 —— 控制台可以主动把 API Key 藏起来（KI-8）：联网模型那两个 Key 输入框以前是 `type="text"`，打开控制台就把明文密钥摆在脸上，终端 / 适配日志 / 权限日志 / 页脚也可能把它打出来；现在两个框默认就是圆点、各配一个「显示 / 隐藏」按钮由她自己决定什么时候看，并在写入终端前按三种形状脱敏（已保存的那把密钥整串、`sk-…`、`Bearer …`），其余文字（含 `C:\Users\…` 这种普通路径）一个字都不改。第一版顺手加的「录制模式」总开关被她当天否掉（「我只需要能主动隐藏 API key 的功能，不要加录制什么的」）⇒ **已整条删掉**。
1.1.4 的验收：真渲染端 CDP **26/26**、离线 `node --check`（内联脚本 54,433 字符）、安装器与绿色包两条路线各自逐字节一致（各 711 个文件）、她那份 1.1.3 原地升到 1.1.4，数字见 [known-issues.md](known-issues.md) 的「1.1.4 的验收」。
