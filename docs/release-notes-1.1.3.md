# Release notes — Cute Fat Fish Pet 1.1.3

**Feature release.** 2026-10-09 · Windows x64 · MIT · [中文说明见下方](#中文说明)

1.1.2 stopped the online model from saying its thinking out loud. 1.1.3 is about one sentence you can
now say to her and mean three different things: 「打开 X」 — a **website** (`打开 A站首页`), a **folder
or file** on this PC (`打开 下载文件夹`, `打开 报告.docx`), or an **app** (`打开 求生之路2`). It works
the same whether you **type** it in the chat or **say** it out loud.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.3-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.3/cute-fat-fish-pet-1.1.3-setup.exe) | `347865488` B | `88A64CF8432669F230B54647D0AF35B79FE6C3035CCEF4227E9AE2F766A1202D` |
| [`cute-fat-fish-pet-1.1.3-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.3/cute-fat-fish-pet-1.1.3-win-x64.zip) | `417001082` B | `5BAB95740EA66117E72B9060E86621242B774EC757C674BAE27C3EF5EF790A21` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.3-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and
if an older copy is registered it upgrades **that** directory instead of adding a second ~761 MB tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).

## What changed in 1.1.3

**Symptom.** 「打开 A站首页」 opened nothing; 「打开 下载文件夹」 was treated as an app name and came
back as *not found*; 「打开 报告.docx」 the same. Only `http://…`/`www.…` URLs and app names got through,
because the router only had two buckets — URL and app.

**Fix — a real classifier for what she heard.** A new engine file,
`runtime/electron-helper/targets.js`, turns the words after 「打开」 into one of three kinds, in this
order: website → local path → system folder → drive → site alias → app (the fallback). Both the
**voice** path and the **typed** path go through the same function, so they cannot drift apart.

- **Websites** — `https://…`, `www.…`, or a curated alias list: A站/acfun, B站/小破站/哔哩哔哩,
  知乎, 微博, 百度, 贴吧, 淘宝, 天猫, 京东, 拼多多, 豆瓣, 抖音, 快手, 小红书, 腾讯视频, 爱奇艺,
  优酷, 网易云音乐, QQ音乐, 维基百科, 必应, GitHub, YouTube, Twitter, Facebook. Trailing
  「首页 / 主页 / 官网 / 官方网站 / 网站 / 网页 / 网址 / 官方」 and sentence-final particles
  (吧 / 呀 / 啊 / 哦 / 嘛 / 呢 / 啦 …) are stripped first, so 「B站吧」 works.
- **Folders and files** — `下载/下载夹/下载目录/下载文件夹` → the real Downloads folder, and the same
  for 文档/我的文档/文稿, 图片/照片/相册, 桌面, 视频/影片, 主目录/用户目录/家目录, 临时文件夹;
  `音乐文件夹` works while 「打开 音乐」 still starts your music **app**. `D盘`/`d:`/`D:\` →
  `D:\`, absolute paths are opened as-is, and a bare name is looked up in
  桌面 / 下载 / 文档 / 图片 / 视频 / 音乐.
- **Searching** — 「百度一下 …」 / 「搜一下 …」 / 「查一下 …」 opens the results page: Bing by default,
  Baidu when you actually said 百度.
- **Apps** — unchanged. 「打开 求生之路2」, 「打开 微信」, 「打开 我的电脑」 still take the old path
  (Start-menu/desktop shortcuts, the Chinese-name map, and your own `aliases.json`).

**Fix — the third permission switch.** Opening files and folders is a new capability, so it gets its
own switch: **允许她打开文件夹/文件** (default **off**, like the other two). With it off she answers
with the permission line and nothing opens. Apps and websites keep their existing switches.

**Fix — she never guesses, and only ever opens.** If a bare file name matches more than one thing she
asks *which* one; if nothing matches she says she could not find it. The lookup reads the top level of
those six folders read-only, and it deliberately **skips shortcuts and executables**
(`.lnk`/`.url`/`.exe`/`.bat`/`.cmd`) — those are apps, and the file permission must never be able to
launch software by accident. She only ever calls `shell.openPath` / `shell.openExternal`: no delete, no
move, no rename. Requests that mean "uninstall X" are still refused outright.

**Also:** the packaged smoke self-test now *waits* for the context menu before checking it (it used to
report a false negative because the menu is built after two `await`s); version 1.1.3 in the four
`package.json` files and the `!define APP_VER` default of `build\installer.nsi`.

## What is affected

- **Voice input and typed chat** (the chat box and the voice path share one router).
- Everything else is untouched: animations, drag physics, click-through, the menus, OBS recording,
  screen watching and the online/local model paths.
- An ordinary sentence is still not intercepted — she only acts when the sentence is a command.

## Requirements

Windows 10/11 x64, about 761 MB unpacked. A GPU is optional; local models run on Ollama if you have it.

## Known limitations

- **File lookup is one level deep** in the six known folders — it does not walk subdirectories and has
  no fuzzy or pinyin matching. For a nested file, say the path (`打开 D:\我的游戏\存档`).
- The site list is curated, not a search: an unknown name falls through to the **app** path, which is
  what makes 「打开 求生之路2」 start a game.
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

1.1.2 让联网模型不再把「思考过程」念出来；1.1.3 只做一件事：让「打开 X」这句话真的能开三种东西 ——
**网页**（`打开 A站首页`）、**本机的文件夹或文件**（`打开 下载文件夹`、`打开 报告.docx`）、
**软件**（`打开 求生之路2`）。而且**打字说和开口说完全一样**。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.3-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.3/cute-fat-fish-pet-1.1.3-setup.exe) | `347865488` B | `88A64CF8432669F230B54647D0AF35B79FE6C3035CCEF4227E9AE2F766A1202D` |
| [`cute-fat-fish-pet-1.1.3-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.3/cute-fat-fish-pet-1.1.3-win-x64.zip) | `417001082` B | `5BAB95740EA66117E72B9060E86621242B774EC757C674BAE27C3EF5EF790A21` |

每个文件都有一个 `.sha256` 同名文件（格式 `<SHA256>  <文件名>`）。核对下载：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.3-setup.exe -Algorithm SHA256
```

另外还有一份去掉版本号的安装器副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），那个链接永远指向最新版。

## 安装

双击安装器就行：不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果检测到已登记的旧版本，
会**装回同一个目录**，不会再铺一份 761 MB。

绿色包也一样：先右键 →「全部解压缩…」，然后二选一 —— 双击 `安装.cmd`（建快捷方式 + 登记卸载），
或者跑 `standalone\start-pet.vbs`（不写注册表）。

## 这一版改了什么

**现象。** 说「打开 A站首页」没反应；说「打开 下载文件夹」「打开 报告.docx」会被当成软件名去找，最后回一句
「没找到」。只有 `http://…`/`www.…` 开头的网址和软件名能走通 —— 因为原来的路由只有两个桶：网址、软件。

**修法 —— 给她一个真正会分类的「目标判定」。** 新增引擎文件
`runtime/electron-helper/targets.js`：把「打开」后面那串字按固定顺序判成三类之一 ——
网址 → 本机路径 → 系统文件夹 → 盘符 → 站点别名 → 软件（兜底）。**语音与打字走的是同一个函数**，
不可能出现两套行为。

- **网址**：`https://…`、`www.…`，以及一份人工整理的别名表：A站/acfun、B站/小破站/哔哩哔哩、知乎、微博、
  百度、贴吧、淘宝、天猫、京东、拼多多、豆瓣、抖音、快手、小红书、腾讯视频、爱奇艺、优酷、网易云音乐、
  QQ音乐、维基百科、必应、GitHub、YouTube、Twitter、Facebook。判定前先削掉句尾的
  「首页 / 主页 / 官网 / 官方网站 / 网站 / 网页 / 网址 / 官方」和语气词（吧/呀/啊/哦/嘛/呢/啦…），
  所以「B站吧」也能认。
- **文件夹与文件**：`下载/下载夹/下载目录/下载文件夹` → 真正的下载目录，文档/我的文档/文稿、图片/照片/相册、
  桌面、视频/影片、主目录/用户目录/家目录、临时文件夹同理；`音乐文件夹` 能开文件夹，而「打开 音乐」仍然是
  开音乐**软件**。`D盘`/`d:`/`D:\` → `D:\`，绝对路径原样打开，只给一个名字时去
  桌面 / 下载 / 文档 / 图片 / 视频 / 音乐 里找。
- **搜索**：「百度一下 …」「搜一下 …」「查一下 …」直接开结果页 —— 默认必应，说了「百度」就用百度。
- **软件**：不变。「打开 求生之路2」「打开 微信」「打开 我的电脑」还是老路（开始菜单/桌面快捷方式、
  中文对照表、以及你自己的 `aliases.json`）。

**修法 —— 第三个权限开关。** 打开文件/文件夹是新能力，所以给它单独一个开关：**允许她打开文件夹/文件**
（默认**关闭**，和前两个一样）。关着的时候她只回一句权限提示、什么都不开。软件与网页沿用原来的开关。

**修法 —— 她永远不猜，而且只开不删。** 同名文件有多个时她会问是哪一个；一个都没找到就如实说没找到。
查找是**只读**、只扫那六个目录的**顶层**，并且刻意**跳过快捷方式与可执行文件**
（`.lnk`/`.url`/`.exe`/`.bat`/`.cmd`）—— 那些属于软件那条路，文件权限绝不能顺手把软件拉起来。
她只会调 `shell.openPath` / `shell.openExternal`：不删除、不移动、不改名。凡是意思是「卸载 X」的请求，
照旧直接拒绝。

**另外：** 包内自检对右键菜单的检查改成「等菜单挂出来再查」（以前因为菜单要等两个 `await` 才建，自检会误报
失败）；四个 `package.json` 与 `build\installer.nsi` 的 `!define APP_VER` 都升到 1.1.3。

## 影响范围

- **语音输入与打字聊天**（聊天框和语音走的是同一个路由器）。
- 其他一切不动：动画、拖拽物理、鼠标穿透、菜单、OBS 录制、看屏幕、在线/本机模型。
- 普通聊天依旧不会被拦截 —— 只有像命令的句子才会触发动作。

## 系统要求

Windows 10/11 x64，解压后约 761 MB。显卡可选；本地模型走你已经装好的 Ollama。

## 已知限制

- **文件查找只有一层**：只在那六个目录的顶层找，不递归、不支持拼音或模糊匹配。文件在子目录里就把路径说出来
  （`打开 D:\我的游戏\存档`）。
- 站点别名是人工整理的清单，不是搜索：认不出来的名字会落到**软件**那条路 —— 「打开 求生之路2」能开游戏正是靠这个。
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
