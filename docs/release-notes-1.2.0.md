# Release notes — Cute Fat Fish Pet 1.2.0

**Feature release.** 2026-10-09 · Windows x64 · MIT · [中文说明见下方](#中文说明)

Someone installs this on a brand-new machine and then a new version comes out. Until now the only way
to get it was to find the release page, download 347 MB by hand, quit the console *and* the pet, and run
the installer over the old directory. 1.2.0 makes that one button: **the console now checks GitHub for a
new version, downloads the installer, verifies its SHA-256, closes itself, installs silently over the
same directory and starts itself and the pet back up.**

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.0-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.0/cute-fat-fish-pet-1.2.0-setup.exe) | `347802318` B | `22DB908B29AB28E6C811FC8019E624240BAEC676E9A6D046D330EA39643CAFB4` |
| [`cute-fat-fish-pet-1.2.0-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.0/cute-fat-fish-pet-1.2.0-win-x64.zip) | `417016073` B | `75EA491EBF46B2A4ADBDA1EE6589AC8ACEE17F1E397E0A928EC8D2110AA44502` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.0-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and
if an older copy is registered it upgrades **that** directory instead of adding a second ~761 MB tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).

## What changed in 1.2.0

**Why.** "How does a person who installed this on a clean machine update it?" The old answer was
"download it and run it over the top, and remember to quit the pet first". The new answer is one button
in the console. Nothing else about updating changed — the same installer, the same directory, the same
user data.

**New 更新 section in the console.**

- **检查更新** asks `https://api.github.com/repos/12we21/cute-fat-fish-pet/releases/latest` and shows
  current version → new version, release date and the release notes. Answers are honest about *why* it
  failed: no network / blocked / needs a proxy, GitHub rate-limiting us (anonymous API allows 60
  requests per hour), or a release feed it could not read. When it cannot reach GitHub there is always a
  **在浏览器里打开发布页** button as the manual way out.
- **下载并更新** downloads the installer attached to that release into `<data root>\updates\`, streaming
  it to disk while computing SHA-256 on the fly (progress shows MB, percent and speed). The hash is the
  `digest` GitHub publishes on the asset itself; **if a release has no hash, the console refuses to
  install it automatically** — it tells you to download it by hand instead. A file that fails the check
  is deleted, never executed. A file that was already downloaded and still matches is reused, so a
  retry after a failed install does not re-download 347 MB.
- **The console cannot overwrite itself** — `electron.exe` is locked by the running console — so the
  real work is handed to a generated `apply-update.ps1` (written with a UTF-8 BOM, because PowerShell
  5.1 needs it to read Chinese paths). A tiny generated `apply-update.vbs` starts it through
  `wscript.exe`: PowerShell is a console program, and a console program started with no console exits
  immediately without doing anything. It waits for the console to
  exit (60 s at most; if it never exits, **nothing is touched**), stops the pet, runs
  `setup.exe /S /D=<the same directory>`, then removes the four portable scripts the zip channel left
  behind, deletes the 347 MB installer, writes the outcome, and starts the pet (only if it was running)
  and the console back up. A failed install still reopens the console, on the old version, so you are
  never left staring at nothing.
- **The result is read back on the next start** and reported in the terminal — and it is judged by
  comparing version numbers, not by trusting what the script reported. A "success" whose version did not
  actually move is shown as a failure. Results older than a week are not mentioned again.
- **Silent installs into the right directory.** The console writes
  `HKCU\Software\BlueHairMaid\InstallDir` before installing, which is both what the NSIS installer reads
  for its default directory and the key the portable-zip channel never wrote. Paths containing spaces
  fall back to the 8.3 short path, because NSIS requires `/D=` to be the last, unquoted argument.
- **Source checkouts are refused.** If `electron\electron.exe` and `launcher\main.js` are not both
  present (running from a git clone), the console says so and tells you to `git pull` instead.
- **Optional mirror.** A first line in `<data root>\update-mirror.txt` (or the `DSH_PET_UPDATE_MIRROR`
  environment variable) redirects only the **asset download** to another host, for networks that cannot
  reach GitHub's release CDN. The update check still talks to GitHub directly.

**Also:** version 1.2.0 in the four `package.json` files and the `!define APP_VER` default of
`build\installer.nsi`; new module `launcher\update.js` (about one third of it is the generated
PowerShell, and it is now listed in `build\check-release.mjs` so the release proves its bytes).

## What is affected

- **The console window**: one new section, plus `launcher\update.js` in the main process.
- Everything else is untouched: the pet, chat, voice, the three permission switches, drag physics,
  click-through, the menus, OBS recording, screen watching, and the API-key masking from 1.1.4.

## Requirements

Windows 10/11 x64, about 761 MB unpacked. A GPU is optional; local models run on Ollama if you have it.
One-click updating needs to reach `api.github.com` and `github.com` (or a mirror).

## Known limitations

- **A full re-download every time.** There is no delta patcher; each update pulls the whole ~347 MB
  installer again. The already-downloaded copy is reused only when the hash matches.
- **Update checks are rate-limited** by GitHub: 60 anonymous requests per hour per IP address. The
  console says so when it hits the limit; it does not silently pretend to be up to date.
- Nothing is downloaded from anywhere but the release's own assets, and only an asset that carries a
  `sha256` digest is installed automatically — but the installer is still **not code-signed**, so
  SmartScreen shows "Windows protected your PC" once (*More info* → *Run anyway*).
- **The pet and the console are restarted by the update.** Anything mid-sentence or mid-recording is
  interrupted; the update takes a couple of minutes.
- On a **portable-zip** install the update deletes that channel's four scripts (`安装.cmd`, `卸载.cmd`,
  `install.ps1`, `uninstall.ps1`) after the installer has taken over uninstall duty — the data directory
  is untouched either way.
- If the console is installed to a directory it may not write to, the update cannot install; the log
  says so (see below).
- No auto-start, no background update check: nothing happens until you press the button.
- File names and in-app text are still Chinese; the repository and the GitHub page are English-first.

Update logs live in `<data root>\updates\update-<version>.log`, and the last outcome in
`<data root>\updates\last-result.txt` (read and deleted on the next start).

## Updating to a newer version

**From 1.1.4 or 1.2.0:** open the console → **更新** → **检查更新** → **下载并更新**. The window closes
by itself, installs, and comes back on the new version.

**By hand (any older version, or if the button cannot reach GitHub):**

1. Download the new `cute-fat-fish-pet-setup.exe` (or the zip) and `.sha256`; check the hash.
2. **Quit the console and the pet** (tray icon → quit, or `standalone\stop-pet.vbs`).
3. Run the new installer — it finds the registered directory and installs over it. Your settings,
   chat history, personas and photos live in `%APPDATA%\BlueHairMaid` and are never touched.
4. Start her again; the console shows the new version.

Permanent link to the latest installer:
`https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`

## License and attribution

MIT (see [LICENSE](../LICENSE)). The upstream pet `dsh-pet` 0.3.0 by PC2005-cloud is MIT as well; of
its 243 public files, 232 are byte-identical here and 11 are deliberately modified (each with size and
reason in [differences-from-upstream.md](differences-from-upstream.md)), no upstream file was deleted,
and we add three engine files of our own (`obs-ctl.js`, `stt-worker.mjs`, `targets.js`) plus the
console-side `launcher\update.js`. `assets/第三方声明.txt` inside the package lists every bundled
component.

---

## 中文说明

**功能版。** 2026-10-09 · Windows x64 · MIT

别人在一台全新的电脑上装完之后，出了新版怎么办？以前只能自己去发布页找、手动下 347 MB、先退出控制台和桌宠，
再把安装器盖上去。1.2.0 把这件事变成控制台里的一个按钮：**检查 GitHub 有没有新版 → 下安装包并核对
SHA-256 → 关掉自己 → 静默装回同一个目录 → 把桌宠（本来在跑的话）和控制台自己开回来。**

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.0-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.0/cute-fat-fish-pet-1.2.0-setup.exe) | `347802318` B | `22DB908B29AB28E6C811FC8019E624240BAEC676E9A6D046D330EA39643CAFB4` |
| [`cute-fat-fish-pet-1.2.0-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.0/cute-fat-fish-pet-1.2.0-win-x64.zip) | `417016073` B | `75EA491EBF46B2A4ADBDA1EE6589AC8ACEE17F1E397E0A928EC8D2110AA44502` |

每个文件都有一个 `.sha256` 同名文件（格式 `<SHA256>  <文件名>`）。核对下载：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.0-setup.exe -Algorithm SHA256
```

另外还有一份去掉版本号的安装器副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），那个链接永远指向最新版。

## 安装

双击安装器就行：不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果检测到已登记的旧版本，
会**装回同一个目录**，不会再铺一份 761 MB。

绿色包也一样：先右键 →「全部解压缩…」，然后二选一 —— 双击 `安装.cmd`（建快捷方式 + 登记卸载），
或者跑 `standalone\start-pet.vbs`（不写注册表）。

## 这一版改了什么

**起因。**「在全新电脑上装完的人，要怎么更新？」老答案是「自己去下载、盖上去，记得先退出桌宠」。
新答案是控制台里的一个按钮。更新这件事本身没变：还是同一个安装器、同一个目录、同一份用户数据。

**控制台新增「更新」一栏。**

- **检查更新**：问的是 `https://api.github.com/repos/12we21/cute-fat-fish-pet/releases/latest`，界面上
  显示「当前版本 → 新版号」、发布时间和发布说明。失败原因会如实说清楚：没网 / 被挡 / 需要代理、
  GitHub 限流（匿名接口每小时 60 次）、或者发布信息读不出来。连不上 GitHub 时永远有一个
  **在浏览器里打开发布页** 的按钮兜底。
- **下载并更新**：把那一版 release 里的安装包下到 `<数据根>\updates\`，一边流式写盘一边算 SHA-256
  （进度显示 MB、百分比、速度）。哈希用的是 GitHub 在资产上给的 `digest`；**发布里没给哈希就拒绝自动装**，
  只会提示你去手动下。校验不过的文件直接删掉、绝不执行；已下过且哈希还对的那份会复用，
  所以装失败后重试不会又下 347 MB。
- **控制台没法覆盖自己**（`electron.exe` 正被运行中的它锁着），所以真正的活交给现场生成的
  `apply-update.ps1`（写盘时带 UTF-8 BOM —— PowerShell 5.1 读中文路径要靠它），再由一个同样现场生成的
  `apply-update.vbs` 通过 `wscript.exe` 把它拉起来（PowerShell 是控制台程序：没有控制台地起它，它会立刻
  退出码 0、什么都不做），然后：
  等控制台退出（最多 60 秒；要是它一直不退，**什么都不动**）→ 停桌宠 → `setup.exe /S /D=<原目录>` →
  清掉 zip 那条路留下的 4 个便携脚本、删掉 347 MB 安装包 → 写结果 → 把桌宠（本来在跑才拉）和控制台开回来。
  装失败也会把控制台按原样开回来（还是旧版），不会让人对着黑屏。
- **结果下次启动回读**：在终端里如实报一句，而且判定靠**版本号比对**、不信脚本自报 ——
  自称成功但版本没动的，会照样报失败。超过一周的旧结果不再念叨。
- **静默装到正确的目录**：装之前控制台会先写 `HKCU\Software\BlueHairMaid\InstallDir` —— 这既是 NSIS 安装器
  读默认目录用的键，也是绿色包渠道从来没有写过的那个键。路径里有空格时改用 8.3 短路径（NSIS 规定
  `/D=` 必须是最后一个、且不能带引号的参数）。
- **源码目录拒绝自动更新**：如果没有同时具备 `electron\electron.exe` 和 `launcher\main.js`（也就是从 git 克隆
  直接跑），控制台会明说让你自己 `git pull`。
- **可选镜像**：`<数据根>\update-mirror.txt` 的第一行（或环境变量 `DSH_PET_UPDATE_MIRROR`）可以把**资产下载**
  换到别的地址，给连不上 GitHub 下载 CDN 的网络用；检查更新仍然直连 GitHub。

**另外：** 四个 `package.json` 与 `build\installer.nsi` 的 `!define APP_VER` 升到 1.2.0；新增模块
`launcher\update.js`（约三分之一是生成的 PowerShell 脚本），并且已登记进 `build\check-release.mjs`，
发布对账会一并证明它的字节。

## 影响范围

- **只有控制台**：多了一栏界面，以及主进程里的 `launcher\update.js`。
- 其他一切不动：桌宠本体、聊天、语音、三个权限开关、拖拽物理、鼠标穿透、菜单、OBS 录制、看屏幕，
  以及 1.1.4 那套 API Key 脱敏。

## 系统要求

Windows 10/11 x64，解压后约 761 MB。显卡可选；本地模型走你已经装好的 Ollama。
一键更新需要能连上 `api.github.com` 和 `github.com`（或者配一个镜像）。

## 已知限制

- **每次都整包重下。** 没有增量补丁，每一版都要重新拉约 347 MB；只有哈希对得上时才会复用已下好的那份。
- **检查更新受 GitHub 限流**：同一个 IP 每小时 60 次匿名请求。撞到上限时控制台会直说，不会假装自己是最新版。
- 只从那一版 release 自己的资产里下载，而且只有带 `sha256` 摘要的资产才会自动装 —— 但安装器依然**没有代码签名**，
  所以 SmartScreen 会拦一次（「更多信息」→「仍要运行」）。
- **更新会重启桌宠与控制台**：正在说的话、正在录的东西都会被打断，整个过程两三分钟。
- **绿色包**渠道更新后，那 4 个便携脚本（`安装.cmd`、`卸载.cmd`、`install.ps1`、`uninstall.ps1`）会被删掉 ——
  卸载改成由新登记的卸载项负责；数据目录两种渠道都不动。
- 如果控制台装在它没有写权限的目录，更新装不进去，日志里会写清楚（见下）。
- 没有开机自启、也不会后台悄悄检查：你不点，它什么都不做。
- 包内文件名与文案仍是中文；仓库与 GitHub 页面以英文为主。

更新日志在 `<数据根>\updates\update-<版本号>.log`，上次的结局在 `<数据根>\updates\last-result.txt`
（下次启动读一次就删）。

## 以后怎么升级

**1.1.4 或 1.2.0 起**：打开控制台 → 「更新」→「检查更新」→「下载并更新」。窗口会自己关掉、自己装好、
再自己开回来。

**手动（更早的版本，或者按钮连不上 GitHub 时）：**

1. 下载新的 `cute-fat-fish-pet-setup.exe`（或 zip）与 `.sha256`，核对哈希。
2. **先退出控制台与桌宠**（托盘图标退出，或 `standalone\stop-pet.vbs`）。
3. 跑新安装器 —— 它会认出已登记的目录并装回去。你的设置、聊天记录、人设、照片都在
   `%APPDATA%\BlueHairMaid`，永远不动。
4. 重新启动她，控制台会显示新版本号。

永远指向最新安装器的链接：
`https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`

## 许可与署名

MIT（见 [LICENSE](../LICENSE)）。上游桌宠 `dsh-pet` 0.3.0（PC2005-cloud）同样是 MIT；它公开的 243 个文件里，
**232 个与本仓库逐字节相同、11 个是刻意修改的**（每个都带大小与原因，见
[differences-from-upstream.md](differences-from-upstream.md)），没有删掉上游任何文件；我们另外加了三个引擎文件
（`obs-ctl.js`、`stt-worker.mjs`、`targets.js`）以及控制台侧的 `launcher\update.js`。
包内 `assets/第三方声明.txt` 列了所有随包分发的组件。
