# Release notes — Cute Fat Fish Pet 1.1.1

**Portable-zip fix release: unpack it, double-click `安装.cmd`, and it installs.** 2026-10-08 · Windows x64 · MIT

[中文说明见下方](#中文说明)

## What this release is

[1.1.0](release-notes-1.1.0.md) was the first public release. 1.1.1 is a small, focused fix release for the **portable zip**:
three defects could make "unpack the zip, double-click `安装.cmd`" fail, print nothing, or install a copy that still
called itself 1.0.0 — and while testing the fix, a fourth one turned up in the uninstaller, which left the whole
installation directory behind. All four are fixed, verified on a real Windows machine and written up in
[known-issues.md](known-issues.md) (symptom → reproduction → root cause → fix).

The `setup.exe` installer was never affected by the first three (it does not use those scripts), and it is rebuilt here
only so that its version number matches. Its behaviour is unchanged from 1.1.0.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.1-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.1/cute-fat-fish-pet-1.1.1-setup.exe) | 347882493 B (331.8 MB) | `9A0DBB160E92C9192E1F7BB7D37D620B45F0F77DCE462A9ACC1AEB3908FC2022` |
| [`cute-fat-fish-pet-1.1.1-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.1/cute-fat-fish-pet-1.1.1-win-x64.zip) | 416992984 B (397.7 MB) | `18A22ED88D221F71BA3872D3CA9A854B09BEF8C07B3EEBE6E71F8C0544C4C4DC` |

Both files also have a `.sha256` next to them on the release page, in the format `<SHA256>  <filename>`; to check a
download yourself:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.1-setup.exe -Algorithm SHA256
```

The aliases `cute-fat-fish-pet-setup.exe` / `cute-fat-fish-pet-setup.exe.sha256` point at the same bytes and never
change name, so `https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`
always downloads the newest installer.

## What changed in 1.1.1

- **The portable `安装.cmd` no longer vanishes (KI-1).** The old wrapper (285 B) only paused when PowerShell returned a
  non-zero exit code — but Windows PowerShell prints `The argument '…' to the -File parameter does not exist` to stderr
  and exits **0** when the script is missing, which is exactly what happens if you double-click `安装.cmd` **inside the
  zip preview window** (Windows runs it from a temporary copy where the rest of the package is not there). The window
  closed instantly and said nothing. The new `安装.cmd` (3,941 B) checks for `install.ps1`, `electron\electron.exe` and
  `app\package.json` first, prints a Chinese explanation through `powershell -EncodedCommand` (so no code page can
  mangle it), and always pauses.
- **The portable install carries the real product name and version (KI-2).** `install.ps1` (9,284 B → 11,085 B) used to
  write the old name 「蓝毛小女仆」 and version `1.0.0` into the shortcut and the "Apps & features" entry. It now uses
  「可爱大肥鱼桌宠」 (the same string as the installer), reads the version from the packaged `app\package.json`, and
  shares the publisher string with the installer. If an old `蓝毛小女仆` shortcut still points at the directory being
  installed, it is renamed to `.lnk.bak-<timestamp>` instead of leaving two icons on the desktop.
- **Chinese text in a `.cmd` no longer breaks parsing (KI-3).** The old `.cmd` was UTF-8 with Chinese comments and ran
  `chcp 65001`; `cmd.exe` parses batch files byte by byte, so lines after the code-page switch were mis-read
  (`'onPolicy' is not recognized as an internal or external command` was really half of `-ExecutionPolicy`). Both
  `.cmd` files are now pure ASCII, without BOM, with LF endings; Chinese messages come from PowerShell.
- **Uninstalling really uninstalls (KI-5, found while testing this release).** The uninstaller used to run *from inside*
  the directory it was deleting — `cmd.exe`'s working directory was the install folder and it was reading `卸载.cmd`
  itself — so `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue` failed as a whole, silently, and all 714 files
  stayed on disk. `卸载.cmd` (1,086 B → 1,298 B) now parks its working directory in `%TEMP%`; `uninstall.ps1`
  (5,221 B → 8,191 B) deletes everything except the `.cmd` file that is still open, and a detached hidden helper
  finishes the job a moment after the window closes.
- Version 1.1.1 in the four `package.json` files and in `build\installer.nsi`; the `README.md` shipped inside the
  package no longer names a version, so future releases do not have to touch a packaged file.

## How to install the portable zip

1. Right-click the zip → **Extract All…** and unpack it anywhere (about 761 MB unpacked).
   Do **not** double-click `安装.cmd` inside the zip preview window — Windows would run it from a temporary folder where
   the rest of the package is missing (that is the case the new wrapper now explains politely).
2. In the extracted folder, double-click **`安装.cmd`**. It needs no administrator rights, copies the tree next to
   itself, creates the desktop and Start-menu shortcut and registers the uninstall entry, so the pet appears in
   **Settings → Apps** as 「可爱大肥鱼桌宠 1.1.1」.
3. To remove it, run **`卸载.cmd`** in the same folder (or Settings → Apps → 可爱大肥鱼桌宠 → Uninstall). Your pet's
   data in `%APPDATA%\BlueHairMaid` is kept.
4. If you only want to try her without touching the registry at all, run `standalone\start-pet.vbs` instead — no
   shortcuts, no uninstall entry.

## Verification

This release was accepted on a real Windows 10 machine, on the artifacts that are published here:

- unpacked the zip → ran `安装.cmd` (finished in 10.2 s, printed the Chinese progress messages and `[ok] Setup finished.`)
  → `build\verify-install.py` compared the installed tree against the staged tree: **710 of 710 files byte-identical**
  (797,834,384 B);
- the registry entry it created reads `DisplayName=可爱大肥鱼桌宠`, `DisplayVersion=1.1.1`,
  `UninstallString="<install dir>\卸载.cmd"`;
- ran that uninstaller: shortcuts and uninstall entry removed, `%APPDATA%\BlueHairMaid` untouched, and the install
  directory was **gone two seconds after the window closed**;
- gates: `build\check-release.mjs` (staged tree identical to the repository byte for byte), `build\check-paths.mjs`
  (no local paths or private directories), `build\nsi-syntax-check.py`, `build\mkzip.py`, `build\mkexe.py`, and the
  `verify.mjs` that ships inside the package.

You can repeat all of it yourself — `docs\development-log.md` (step 11) lists the exact commands, and every defect has a
reproduction recipe in `docs\known-issues.md`.

## Known limitations

- The binaries are **not code-signed**, so Windows SmartScreen will say "Windows protected your PC" the first time; click
  *More info* → *Run anyway*. See [code-signing.zh-CN.md](code-signing.zh-CN.md).
- **No autostart and no auto-update.** To start her with Windows, put a shortcut in `shell:startup`. A "check for
  updates" button inside the console is planned for 1.2.0; update checks that download and run an installer silently
  would need code signing first.
- File names and in-package text are still Chinese (English is the repository's front page; the product itself speaks
  Chinese).
- `src\lib\` and the assembled `app\` tree are build output, not handwritten source — the handwritten source sits next to
  them (`src\host\`, `runtime\electron-helper\`, `launcher\`, `standalone\`).
- GitHub shows the licence as `NOASSERTION` because `LICENSE` contains two copyright blocks (upstream + this project).

## Updating to a newer version

1. Download the newest `cute-fat-fish-pet-setup.exe` (permanent link:
   `https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`).
2. Run it — the wizard recognises the existing installation and upgrades it in place (one 761 MB copy, not two).
3. Portable-zip users: unpack the new zip over (or next to) the old folder and run `安装.cmd` again; it reuses the
   directory you already have.
4. Your pet's data, character settings and API keys stay in `%APPDATA%\BlueHairMaid` and are never overwritten by an
   install or removed by an uninstall.

## License and attribution

MIT. The early architecture comes from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 0.3.0 (MIT,
attribution kept in [NOTICE.md](../NOTICE.md), `LICENSE`, `assets\LICENSE.txt` and `assets\第三方声明.txt`); of the 243
files that upstream 0.3.0 ships, **232 are still byte-identical**, 11 were deliberately modified (each one listed with
sizes and reasons in [differences-from-upstream.md](differences-from-upstream.md)), none were deleted, and two engine
files (`runtime\electron-helper\obs-ctl.js`, `runtime\electron-helper\stt-worker.mjs`) are new here.

---

## 中文说明

**绿色包修复版：解压完双击 `安装.cmd`，这次真的能装上了。** 2026-10-08 · Windows x64 · MIT

### 这是什么

[1.1.0](release-notes-1.1.0.md) 是第一次公开发布；1.1.1 是一次小而集中的修复版，只针对**绿色 zip 包**：
有三个缺陷会让「解压 → 双击 `安装.cmd`」失败、什么都不提示，或者装出来的副本自称 1.0.0；而在验证修复的过程中
又发现了第四个 —— 卸载之后整个安装目录都还在。四个问题都已修好、在真实 Windows 上验收过，并且写进了
[known-issues.md](known-issues.md)（现象 → 复现 → 根因 → 修法，各自都带证据）。

`setup.exe` 安装程序从来没受前三个问题影响（它不走这几个脚本），这次重打只是因为版本号要一致，行为与 1.1.0 完全相同。

### 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.1-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.1/cute-fat-fish-pet-1.1.1-setup.exe) | 347882493 B（331.8 MB） | `9A0DBB160E92C9192E1F7BB7D37D620B45F0F77DCE462A9ACC1AEB3908FC2022` |
| [`cute-fat-fish-pet-1.1.1-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.1/cute-fat-fish-pet-1.1.1-win-x64.zip) | 416992984 B（397.7 MB） | `18A22ED88D221F71BA3872D3CA9A854B09BEF8C07B3EEBE6E71F8C0544C4C4DC` |

两个文件在 Release 页上各有一个 `.sha256`（格式 `<SHA256>  <文件名>`），想自己核对：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.1-setup.exe -Algorithm SHA256
```

别名资产 `cute-fat-fish-pet-setup.exe` / `cute-fat-fish-pet-setup.exe.sha256` 指向完全相同的字节、名字永不变，
所以 `https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`
永远能下到最新安装器。

### 这一版改了什么

- **绿色包的 `安装.cmd` 不再一闪而过（KI-1）**：旧脚本（285 B）只在 PowerShell 返回非 0 时才暂停，可
  「`install.ps1` 不存在」时 Windows PowerShell 的行为是**打一行错误、退出码 0** —— 而这正是
  **在压缩包预览窗口里双击 `安装.cmd`** 的情形（Windows 会把它复制到临时目录执行，包里其它文件都不在）。
  于是窗口瞬间关闭、什么也不说。新的 `安装.cmd`（3,941 B）先检查 `install.ps1`、`electron\electron.exe`、
  `app\package.json`，缺件就用 `powershell -EncodedCommand` 打一段中文说明（任何代码页都不会乱码），并且**永远会暂停**。
- **绿色包装出来的名字和版本是对的（KI-2）**：`install.ps1`（9,284 B → 11,085 B）过去把旧名「蓝毛小女仆」和
  版本 `1.0.0` 写进快捷方式与「应用和功能」。现在用「可爱大肥鱼桌宠」（与安装器同一个字符串）、
  版本从包内 `app\package.json` 读、Publisher 与安装器共用同一串。桌面上若还留着指向本次安装目录的旧名快捷方式，
  会被改名成 `.lnk.bak-<时间戳>` 留档，不会留下两个图标。
- **`.cmd` 里的中文不再让批处理解析错乱（KI-3）**：旧 `.cmd` 是 UTF-8 + 中文注释 + `chcp 65001`，而 `cmd.exe` 是
  按字节解析批处理的，代码页一切换后面的行就被读错（`'onPolicy' is not recognized …` 其实是 `-ExecutionPolicy`
  被吃掉一半）。现在两个 `.cmd` 都是**纯 ASCII、无 BOM、LF 换行**，中文提示全部由 PowerShell 打印。
- **卸载真的能卸载干净（KI-5，本次测试中新发现）**：卸载器过去是**从它正在删的目录里运行的** —— `cmd.exe` 的
  当前目录就是安装目录，而且它正在读 `卸载.cmd` 自己 —— 于是 `Remove-Item -Recurse -Force` 整条失败、还因为
  带了 `-ErrorAction SilentlyContinue` 而完全静默，714 个文件一个没删。现在 `卸载.cmd`（1,086 B → 1,298 B）
  把自己的当前目录挪到 `%TEMP%`；`uninstall.ps1`（5,221 B → 8,191 B）先删掉除「正在用的那个 `.cmd`」以外的所有东西，
  剩下的交给一个隐藏的分离进程，在窗口关闭后再收尾。
- 四个 `package.json` 与 `build\installer.nsi` 的版本号 → 1.1.1；**包内的 `README.md` 不再写死版本号**，
  这样以后的版本不用为了它重打安装包。

### 绿色包怎么装

1. 右键 zip → **全部解压缩…**，解压到任意目录（解开后约 761 MB）。
   **不要**在压缩包预览窗口里双击 `安装.cmd` —— Windows 会把它放到临时目录执行，包里其它文件都不在（新脚本会友好地说明这一点）。
2. 在解压出来的目录里双击 **`安装.cmd`**。不需要管理员权限：它把整棵树复制到脚本旁边，建好桌面与开始菜单快捷方式，
   并登记卸载项，于是「设置 → 应用」里会看到「可爱大肥鱼桌宠 1.1.1」。
3. 想卸载就跑同一目录里的 **`卸载.cmd`**（或「设置 → 应用 → 可爱大肥鱼桌宠 → 卸载」）。
   她在 `%APPDATA%\BlueHairMaid` 里的数据会保留。
4. 只想试试、完全不碰注册表的话，直接跑 `standalone\start-pet.vbs` —— 不建快捷方式、不写卸载项。

### 验收（你可以自己复核）

这次发布是在真实 Windows 10 上、对**现在页面上这两个产物**做的验收：

- 解压 zip → 跑 `安装.cmd`（10.2 秒跑完，中文进度提示与 `[ok] Setup finished.` 都对）→
  `build\verify-install.py` 把装出来的树与 stage 树对比：**710 / 710 个文件逐字节一致**（797,834,384 B）；
- 它写的注册表项是 `DisplayName=可爱大肥鱼桌宠`、`DisplayVersion=1.1.1`、`UninstallString="<安装目录>\卸载.cmd"`；
- 再跑那个卸载器：快捷方式与卸载登记项清掉、`%APPDATA%\BlueHairMaid` 一点没动、
  **安装目录在窗口关闭后 2 秒内消失**；
- 门禁：`build\check-release.mjs`（stage 树与仓库逐字节一致）、`build\check-paths.mjs`（无本机路径/私人目录）、
  `build\nsi-syntax-check.py`、`build\mkzip.py`、`build\mkexe.py`，以及包内自带 `verify.mjs` 的自校验。

想重跑全过程：`docs\development-log.md` 第 11 步列了确切命令；每个缺陷在 `docs\known-issues.md` 里都有复现方法。

### 已知限制

- 二进制**没有代码签名**，第一次运行 SmartScreen 会提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」即可
  （见 [code-signing.zh-CN.md](code-signing.zh-CN.md)）。
- **没有开机自启、没有自动更新**：要自启就把快捷方式拖进 `shell:startup`；控制台里的「检查更新」排在 1.2.0，
  而真正静默自动更新得先有代码签名。
- 包内文件名与文案仍是中文（仓库首页是英文优先，产品本身说中文）。
- `src\lib\` 与拼装出来的 `app\` 是构建产物，手写源码在旁边（`src\host\`、`runtime\electron-helper\`、
  `launcher\`、`standalone\`）。
- GitHub 把许可证识别成 `NOASSERTION`：`LICENSE` 里有两段版权（上游 + 本项目）。

### 以后怎么升级

1. 下载最新的 `cute-fat-fish-pet-setup.exe`（永久链接：
   `https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`）。
2. 直接运行 —— 向导认得旧目录，会**原地升级**（只有一份 761 MB，不会变成两份）。
3. 绿色包用户：把新 zip 解压到旧目录里（或旁边）再跑一次 `安装.cmd`，它会复用你已经有的目录。
4. 她的人设、设置与 API Key 都在 `%APPDATA%\BlueHairMaid`，安装不会覆盖、卸载不会删除。

### 许可与署名

MIT。早期架构来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 0.3.0（MIT，署名保留在
[NOTICE.md](../NOTICE.md)、`LICENSE`、`assets\LICENSE.txt` 与 `assets\第三方声明.txt`）；上游 0.3.0 发布的 243 个文件里
**232 个至今逐字节未改**，11 个刻意修改（每个都带大小与原因，见 [differences-from-upstream.md](differences-from-upstream.md)），
没有删除任何上游文件，另有 2 个引擎文件（`runtime\electron-helper\obs-ctl.js`、`runtime\electron-helper\stt-worker.mjs`）是本项目新增。
