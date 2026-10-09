# Release notes — Cute Fat Fish Pet 1.1.4

**Feature release.** 2026-10-09 · Windows x64 · MIT · [中文说明见下方](#中文说明)

1.1.3 taught her the sentence 「打开 X」. 1.1.4 is for the person filming her: the console now hides the
API key you do not want on camera — the two key fields are dots by default with a 显示 / 隐藏 button
beside each one, and any key the console would print is masked as it is written.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.4-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.4/cute-fat-fish-pet-1.1.4-setup.exe) | `347880285` B | `495F5D3506C419B7967513E3F8C73F655F108FAC965BFF58B643EE018553C5D0` |
| [`cute-fat-fish-pet-1.1.4-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.4/cute-fat-fish-pet-1.1.4-win-x64.zip) | `417002153` B | `54F6832CCC6D609FC26497F12B54EE9DA4016E8ACA2F144246AC0F23CC9542FC` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.4-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and
if an older copy is registered it upgrades **that** directory instead of adding a second ~761 MB tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).

## What changed in 1.1.4

**Why.** Recording a promo video of the console means recording whatever the console shows. It showed
the API key in plain text in two places at once — the two key fields of 「联网模型」, and any log line
that happened to echo it. Editing around that after the fact is no way to record.

**Fix — the console hides the API key.**

- **The key fields are dots by default.** Both key inputs are real `password` fields now, with a
  `显示` / `隐藏` button beside each one. The key is still filled in and saved exactly as before; you
  reveal it per field, and only for as long as you are looking at it. The two fields are independent:
  showing the chat key never reveals the vision key.
- **The console's own output is masked as it is written.** A saved key becomes `••••••`, `sk-…` becomes
  `sk-••••••` and `Bearer <token>` becomes `Bearer ••••••` — in the terminal, the 本机适配 log, the
  permission log and the footer's data path alike. This holds whether the field is currently shown or
  hidden, so a key cannot reach the screen through a log line mid-demo. There is no switch to remember
  and nothing to turn on: the console simply never prints a key it knows.
- **Nothing else is touched.** The masker only rewrites the key and `sk-…` / `Bearer …` tokens; paths,
  user names and ordinary text come out exactly as before.
- **The keys themselves are untouched.** They are read from and written to `standalone\online.json` in
  the same format as always; masking is a display-only layer. It is **not encryption** — that file is
  still plain text, which is exactly why it lives in the app directory and never in a log.

**Also:** version 1.1.4 in the four `package.json` files and the `!define APP_VER` default of
`build\installer.nsi`. The privacy gate also caught this release-notes file itself: it quoted a literal
local test path as a counter-example, `build\check-paths.mjs` rejects those on sight, and the build
stopped on those 2 hits until the path was written the way the rest of the docs write it. Packaging is
green again: 184 files scanned, 0 hits.

## What is affected

- **The console window**, and only it: two new buttons, and how the console writes its own log lines
  to the screen.
- Everything else is untouched: the pet, chat, voice, the three permission switches, drag physics,
  click-through, the menus, OBS recording, screen watching, and both model paths. Nothing the pet says
  in her own speech bubbles is affected either.

## Requirements

Windows 10/11 x64, about 761 MB unpacked. A GPU is optional; local models run on Ollama if you have it.

## Known limitations

- The masker hides what the **console** renders. It does not encrypt or scramble `standalone\online.json`
  itself, and a key typed somewhere else (a chat bubble, another app) is outside its reach.
- The masker knows three shapes: the exact saved key, `sk-…` and `Bearer …`. A screenshot of the pet's
  own window, or one you take yourself, is outside its reach.
- It is a display feature, not a security boundary: anyone who can read the files can read the key.
- The installer is **not code-signed**, so SmartScreen shows "Windows protected your PC" once
  (*More info* → *Run anyway*). SHA-256 hashes are the integrity check.
- No auto-start, no auto-update yet (a one-click update in the console is planned for 1.2.0).
- File names and in-app text are still Chinese; the repository and the GitHub page are English-first.

## Updating to a newer version

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
and we add three engine files of our own (`obs-ctl.js`, `stt-worker.mjs`, `targets.js`).
`assets/第三方声明.txt` inside the package lists every bundled component.

---

## 中文说明

**功能版。** 2026-10-09 · Windows x64 · MIT

1.1.3 教会了她「打开 X」这句话；1.1.4 是给**要拍她的人**的：控制台现在能把不想入镜的 API Key 自己藏起来 ——
两个 Key 框默认就是圆点、各带一个「显示 / 隐藏」按钮，而且控制台自己打印出来的 Key 在写出去时就已经被抹掉。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.4-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.4/cute-fat-fish-pet-1.1.4-setup.exe) | `347880285` B | `495F5D3506C419B7967513E3F8C73F655F108FAC965BFF58B643EE018553C5D0` |
| [`cute-fat-fish-pet-1.1.4-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.4/cute-fat-fish-pet-1.1.4-win-x64.zip) | `417002153` B | `54F6832CCC6D609FC26497F12B54EE9DA4016E8ACA2F144246AC0F23CC9542FC` |

每个文件都有一个 `.sha256` 同名文件（格式 `<SHA256>  <文件名>`）。核对下载：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.4-setup.exe -Algorithm SHA256
```

另外还有一份去掉版本号的安装器副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），那个链接永远指向最新版。

## 安装

双击安装器就行：不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果检测到已登记的旧版本，
会**装回同一个目录**，不会再铺一份 761 MB。

绿色包也一样：先右键 →「全部解压缩…」，然后二选一 —— 双击 `安装.cmd`（建快捷方式 + 登记卸载），
或者跑 `standalone\start-pet.vbs`（不写注册表）。

## 这一版改了什么

**起因。** 要录控制台的宣传视频，就等于把控制台显示的东西一起录进去。而它把 API Key 一次就露两处：
**「联网模型」里那两个 Key 输入框是明文**，日志里任何顺手回显了 Key 的行也是明文。事后打码不是个办法。

**修法 —— 控制台把 API Key 藏起来。**

- **Key 输入框默认就是圆点。** 两个 Key 框改成真正的 `password` 输入框，各自配一个「显示 / 隐藏」按钮。
  Key 的读取与保存一切照旧，只有你主动点「显示」时才明文，而且只影响你点的那一个框 ——
  点开聊天 Key 不会带出视觉 Key。
- **控制台自己打印的东西，写出去时就已经脱敏。** 保存的那把 Key 变成 `••••••`、`sk-…` 变成 `sk-••••••`、
  `Bearer <令牌>` 变成 `Bearer ••••••` —— 终端、本机适配日志、权限日志、页脚的数据路径全都一样。
  输入框当前是显示还是隐藏都无所谓，所以录到一半也不可能有哪一行日志把 Key 漏到屏幕上。
  没有开关要记、没有东西要提前打开：控制台只是不再把自己知道的 Key 打出来。
- **别的一概不动。** 脱敏只改那把 Key 和 `sk-…` / `Bearer …` 令牌；路径、用户名、普通文字都原样输出。
- **Key 本身没动。** 依旧按原格式读写 `standalone\online.json`，脱敏只是显示层。注意这**不是加密** ——
  那个文件本身仍是明文，这也正是它住在程序目录、从不进日志的原因。

**另外：** 四个 `package.json` 与 `build\installer.nsi` 的 `!define APP_VER` 升到 1.1.4。另外，隐私门禁这次拦下的
是**这份发布说明自己**：里面把一条本机测试路径当反面例子原样引用了，而 `build\check-paths.mjs` 见一次拦一次 ——
这 2 处改成该文档体系一贯的写法后，门禁重新干净：扫描 184 个文件、0 命中。

## 影响范围

- **只有控制台窗口**：多了两个按钮，以及它自己往屏幕上写日志的方式。
- 其他一切不动：桌宠本体、聊天、语音、三个权限开关、拖拽物理、鼠标穿透、菜单、OBS 录制、看屏幕、
  在线/本机模型。她自己在气泡里说的话也不受影响。

## 系统要求

Windows 10/11 x64，解压后约 761 MB。显卡可选；本地模型走你已经装好的 Ollama。

## 已知限制

- 脱敏遮的是**控制台渲染出来的东西**。它不会加密或打乱 `standalone\online.json` 本身；你自己打进别的地方
  （聊天框、别的软件）的 Key 它也管不着。
- 脱敏只认三种形状：保存的那把 Key 原文、`sk-…`、`Bearer …`。桌宠自己气泡里的内容、或者你自己另外截的图，
  都不在它的范围内。
- 这是**显示层功能，不是安全边界**：能读到文件的人一样能读到 Key。
- 安装器**没有代码签名**，所以 SmartScreen 会拦一次（「更多信息」→「仍要运行」）。完整性请用 SHA-256 核对。
- 没有开机自启，也还没有自动更新（控制台里的一键更新排在 1.2.0）。
- 包内文件名与文案仍是中文；仓库与 GitHub 页面以英文为主。

## 以后怎么升级

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
（`obs-ctl.js`、`stt-worker.mjs`、`targets.js`）。包内 `assets/第三方声明.txt` 列了所有随包分发的组件。
