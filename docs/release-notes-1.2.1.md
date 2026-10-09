# Release notes — Cute Fat Fish Pet 1.2.1

**Bug-fix release.** 2026-10-09 · Windows x64 · MIT · [中文说明见下方](#中文说明)

1.2.0 gave the console a button that checks GitHub and installs a new version by itself. Three things
about *using* the console were still wrong, and a patch release is the only way for the people who
already downloaded 1.2.0 to get them: **the result of 「测一下通不通」 was invisible, the console fought
a real person (19 px click strips, no focus ring, results scrolled away), and asking her "are you online
or offline?" got a guess instead of an answer.**

Nothing else changed: same engine, same data directory, same one-click updater. Files that were already
correct in 1.2.0 are byte-identical here.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.1-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.1/cute-fat-fish-pet-1.2.1-setup.exe) | `347864787` B | `5D354375D41AD7CC6F8C1B5C87375664384E173B9AEE9520F0CEBDDDED516EC2` |
| [`cute-fat-fish-pet-1.2.1-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.1/cute-fat-fish-pet-1.2.1-win-x64.zip) | `417022629` B | `8C36D3B89C72EC5F968473BCB48AA28C6A93FA0E311261E863D264D2025B2843` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.1-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and if
an older copy is registered it upgrades **that** directory instead of adding a second ~761 MB tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).

## What changed in 1.2.1

**1. 「测一下通不通」 now says something where you are looking.**

- The answer is written on its own line right next to the two buttons (`联网模型：可以连通 · 312 ms`,
  `看屏幕：没有配视觉模型…`) instead of only into the terminal at the bottom of a 2375 px page.
- The same message appears in the **status bar fixed at the bottom of the window**, so a test result is
  visible no matter where you scrolled; there is a **去终端 ↓** link in that bar.
- The probe now saves the fields you just typed before testing. It used to test the *saved* settings,
  so a connection test could quietly check the previous configuration.

**2. The console is usable by a real person.** A pass over every interactive piece, with measurements
(`_accept\ui-audit.cjs`: 123 controls, Tab reachability, hit-target sizes, focus styles, terminal
behaviour):

- **Whole header rows click.** Every collapsed section used to have a 52 px coloured bar of which only a
  19 px strip reacted to a click; now the whole bar toggles it, with a hover tint and a blue arrow.
- **Focus is always visible.** The stylesheet had exactly two `:focus` rules; buttons, summaries, chips
  and segmented options showed nothing when reached by Tab. Every one of them now gets a visible focus
  ring, and the black-and-white review screenshots confirm it.
- **Pressing something feels like pressing something** — a 1 px press and a brightness change on
  buttons, chips, list rows and segmented options (there was hover feedback, but no press feedback).
- **Small targets are bigger**: show/hide API-key buttons 26 → 30 px, chips 19 → 26 px or more with
  padding, checkbox rows 26 px tall with a 15 px box, sliders 16 → 26 px, ghost/utility buttons 32 px.
- **「● 有改动没保存」** appears on a section whose inputs you edited and disappears when you save it
  (sections whose buttons save immediately are not marked). Deliberately **not** a blocking
  "are you sure you want to leave" dialog — this window is meant to stay open all day.
- **Results land where you look.** The terminal grew a **↓ 有新消息** pill when new output arrives while
  you are scrolled up, a **清屏** button, and its own auto-scroll no longer yanks you to the bottom while
  you are reading history.
- **The console remembers**: which sections were open (localStorage `pet.console.sections.v1`), and the
  last 50 commands you typed (↑ / ↓ in the command box).
- **Keyboard reaches everything**: chips and the start-menu app rows now respond to Enter and Space,
  and the segmented 在线 / 本地 / 自动择优 (and 性格) options are reachable by Tab (they were
  `display: none`, so the keyboard could not get in at all).
- **Disabled buttons explain themselves**: 停止桌宠 / 状态页 / 下载并更新 carry a `title` saying why.
- Deleting a saved persona set now takes **two clicks** (the button turns into 「再点一次删掉」 for 3 s).

**3. Asking her "在线还是离线" is answered by code, not guessed.**

- The chat system prompt now carries one line about the current mode; when you ask whether she is online,
  local, which model she uses or where it runs, the answer comes from the real configuration —
  `我现在是在线模式哦——说话走联网的 deepseek-flash（api.deepseek.com）；本机的 deepseek-r1:8b 只在联网连不上时兜底。`
- If the online model is not configured, she says so instead of claiming to be online.
- 「你现在是本地模型吗」 used to be read as the command 「用本地」 and **silently switched the mode**;
  questions (吗 / 呢 / 还是 / 什么 / ？, without a leading 换 / 用 / 切 / 改) are now answered, not executed.
- The status line reports the model too: `在线（deepseek-flash）` instead of just `在线`.

**Also:** version 1.2.1 in the four `package.json` files and the `!define APP_VER` default of
`build\installer.nsi`. No other file changed.

## What is affected

- **The console**: `launcher\index.html` (markup, styles, behaviour) and the plugin/host file
  `src\lib\index.js` (the file behind chat, which is also what the standalone runner loads).
- Everything else is untouched: the pet engine and its animations, voice, the three permission switches,
  drag physics, click-through, the right-click menu, OBS recording, screen watching, the API-key masking
  from 1.1.4, and the one-click updater from 1.2.0.

## Requirements

Windows 10/11 x64, about 761 MB unpacked. A GPU is optional; local models run on Ollama if you have it.
One-click updating needs to reach `api.github.com` and `github.com` (or a mirror).

## Known limitations

- **1.1.4 and older still have to update by hand once.** The 「检查更新 / 下载并更新」 buttons only exist
  from 1.2.0 on; there is no way for code that is not there to update itself.
- **A full re-download every time.** There is no delta patcher; each update pulls the whole installer
  (about `331.7` MB) again. The already-downloaded copy is reused only when the hash matches.
- **Update checks are rate-limited** by GitHub: 60 anonymous requests per hour per IP address.
- The installer is still **not code-signed**, so SmartScreen shows "Windows protected your PC" once
  (*More info* → *Run anyway*).
- **The pet and the console are restarted by the update**; the update takes a couple of minutes.
- No auto-start and no background update check: nothing happens until you press the button.
- File names and in-app text are still Chinese; the repository and the GitHub page are English-first.

## Updating to a newer version

**From 1.2.0:** open the console → **更新** → **检查更新** → **下载并更新**. The window closes by itself,
installs, and comes back on the new version. (From 1.2.1 on, that is also how you get 1.2.2.)

**By hand (any older version, or if the button cannot reach GitHub):**

1. Download the new `cute-fat-fish-pet-setup.exe` (or the zip) and `.sha256`; check the hash.
2. **Quit the console and the pet** (tray icon → quit, or `standalone\stop-pet.vbs`).
3. Run the new installer — it finds the registered directory and installs over it. Your settings,
   chat history, personas and photos live in `%APPDATA%\BlueHairMaid` and are never touched.
4. Start her again; the console shows the new version.

Permanent link to the latest installer:
`https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe`

## License and attribution

MIT (see [LICENSE](../LICENSE)). The upstream pet `dsh-pet` 0.3.0 by PC2005-cloud is MIT as well; of its
243 public files, 232 are byte-identical here and 11 are deliberately modified (each with size and reason
in [differences-from-upstream.md](differences-from-upstream.md)), no upstream file was deleted, and we add
three engine files of our own (`obs-ctl.js`, `stt-worker.mjs`, `targets.js`) plus the console-side
`launcher\update.js`. `assets/第三方声明.txt` inside the package lists every bundled component.

---

## 中文说明

**修复版。** 2026-10-09 · Windows x64 · MIT

1.2.0 已经让控制台能自己检查更新、自己装好新版。但**用**这个控制台还有三件事不对，而且只有重新发一版，
已经下过 1.2.0 的人才能拿到：**「测一下通不通」的结果看不见、界面跟真人作对（19 像素的点击条、没有
焦点圈、结果滚到看不见的地方）、问她「你是在线还是离线」只能靠猜。**

其它一切没变：同一个引擎、同一个数据目录、同一个一键更新。1.2.0 里本来就对的文件，在这一版里逐字节相同。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.1-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.1/cute-fat-fish-pet-1.2.1-setup.exe) | `347864787` B | `5D354375D41AD7CC6F8C1B5C87375664384E173B9AEE9520F0CEBDDDED516EC2` |
| [`cute-fat-fish-pet-1.2.1-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.1/cute-fat-fish-pet-1.2.1-win-x64.zip) | `417022629` B | `8C36D3B89C72EC5F968473BCB48AA28C6A93FA0E311261E863D264D2025B2843` |

每个文件都有一个 `.sha256` 同名文件（格式 `<SHA256>  <文件名>`）。核对下载：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.1-setup.exe -Algorithm SHA256
```

另外还有一份去掉版本号的安装器副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），那个链接永远指向最新版。

## 安装

双击安装器就行：不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果检测到已登记的旧版本，
会**装回同一个目录**，不会再铺一份 761 MB。

绿色包也一样：先右键 →「全部解压缩…」，然后二选一 —— 双击 `安装.cmd`（建快捷方式 + 登记卸载），
或者跑 `standalone\start-pet.vbs`（不写注册表）。

## 这一版改了什么

**一、「测一下通不通」现在会在你看得到的地方说话。**

- 结果写在两个按钮**旁边那一行**（`联网模型：可以连通 · 312 ms`、`看屏幕：没有配视觉模型…`），
  而不是只丢进页面最下面 2375 像素处的终端。
- 同一句话还会出现在**固定在窗口底部的状态条**里 —— 不管你滚到哪儿都看得见，条上还有 **去终端 ↓**。
- 探测之前会先把你刚填进输入框的设置**保存下来再测**。以前测的是「上次保存过的配置」，
  所以刚改完地址就点测试，可能悄悄测的是旧配置。

**二、这个控制台现在是给真人用的。** 把每个可交互的地方都量过一遍
（`_accept\ui-audit.cjs`：123 个控件、Tab 可达性、点击目标尺寸、焦点样式、终端行为）：

- **整条折叠栏都能点。** 以前每个收起的分区有一条 52 像素高的色条，但真正响应点击的只有中间 19 像素；
  现在整条都能开合，还带悬停底色和变蓝的箭头。
- **焦点永远看得见。** 样式表里原本只有 2 条 `:focus` 规则，按钮 / 折叠栏 / chip / 段选用 Tab 走过去
  完全看不出落在哪；现在它们都有可见焦点圈，截图逐张核对过。
- **按下去有按下去的手感** —— 按钮、chip、列表行、段选都有 1 像素下沉 + 变暗（以前只有悬停变亮，
  没有按下反馈）。
- **小目标变大**：显示/隐藏 API Key 的按钮 26 → 30 像素、chip 19 → 26 像素以上（带内边距）、
  复选框整行 26 像素高（勾选框 15 像素）、滑块 16 → 26 像素、工具按钮 32 像素。
- **「● 有改动没保存」**：改过输入框的分区会亮这一行字，点了保存就消失（点了立刻生效的分区不打标）。
  故意**没有**做「你确定要关窗口吗」那种拦截式弹窗 —— 这个窗口本来就是一直开着的。
- **结果落在你看得到的地方。** 终端多了 **↓ 有新消息** 的小胶囊（你在翻历史时有新输出就冒出来）、
  **清屏** 按钮，而且它的自动滚动不再在你往回翻的时候把你拽到底部。
- **控制台记得住**：哪几个分区是展开的（localStorage `pet.console.sections.v1`）、
  你敲过的最近 50 条命令（输入框里 ↑ / ↓ 翻）。
- **键盘什么都能到**：chip 和「开始菜单里的软件」那一行支持回车与空格；「在线 / 本地 / 自动择优」
  （以及性格二选一）本来因为 `display: none` **键盘根本进不去**，现在 Tab 能进去且有焦点圈。
- **灰按钮会说明自己为什么灰**：停止桌宠 / 状态页 / 下载并更新都带 `title`。
- 删掉存好的一套性格现在要**点两下**（第一下按钮变成「再点一次删掉」，3 秒不点就还原）。

**三、问她「在线还是离线」，由代码如实回答，不再靠猜。**

- 对话的 system 提示里现在带着一行运行状态；你问她是不是在线、用本机还是联网、用什么模型、
  跑在哪儿，回答都来自真实配置 ——
  `我现在是在线模式哦——说话走联网的 deepseek-flash（api.deepseek.com）；本机的 deepseek-r1:8b 只在联网连不上时兜底。`
- 联网模型没配全时，她会直说「还没配全、会回落到本机」，而不是硬说自己在线。
- 「你现在是本地模型吗」以前会被当成口令「用本地」，**悄悄把档位改掉**；现在带 吗 / 呢 / 还是 / 什么 / ？
  的问句（且不是以 换 / 用 / 切 / 改 开头）一律只回答、不执行。
- 状态行也会带上模型名：`在线（deepseek-flash）`，不再只有「在线」两个字。

**另外：** 四个 `package.json` 与 `build\installer.nsi` 的 `!define APP_VER` 升到 1.2.1，没有别的文件改动。

## 影响范围

- **只有控制台**：`launcher\index.html`（界面、样式、行为）与插件/宿主文件 `src\lib\index.js`
  （聊天背后那个文件，独立版运行端加载的也是它）。
- 其他一切不动：桌宠引擎与动画、语音、三个权限开关、拖拽物理、鼠标穿透、右键菜单、OBS 录制、看屏幕、
  1.1.4 那套 API Key 脱敏，以及 1.2.0 的一键更新。

## 系统要求

Windows 10/11 x64，解压后约 761 MB。显卡可选；本地模型走你已经装好的 Ollama。
一键更新需要能连上 `api.github.com` 和 `github.com`（或者配一个镜像）。

## 已知限制

- **1.1.4 及更早的版本还是要手动升一次**：「检查更新 / 下载并更新」这两个按钮从 1.2.0 才有，
  不在的代码没法自己更新自己。
- **每次都整包重下。** 没有增量补丁，每一版都要重新拉约 `331.7` MB；只有哈希对得上时才复用已下好的那份。
- **检查更新受 GitHub 限流**：同一个 IP 每小时 60 次匿名请求。
- 安装器依然**没有代码签名**，SmartScreen 会拦一次（「更多信息」→「仍要运行」）。
- **更新会重启桌宠与控制台**，整个过程两三分钟。
- 没有开机自启、也不会后台悄悄检查：你不点，它什么都不做。
- 包内文件名与文案仍是中文；仓库与 GitHub 页面以英文为主。

## 以后怎么升级

**1.2.0 起**：打开控制台 → 「更新」→「检查更新」→「下载并更新」。窗口会自己关掉、自己装好、再自己开回来。
（1.2.1 起，以后拿 1.2.2 也是这条路。）

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
