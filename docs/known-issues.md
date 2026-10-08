# Known issues

English summary: defects that were confirmed in shipped builds, with the reproduction, the root cause
and how they were fixed. Open items come first, then the ones fixed in 1.1.1 / 1.1.2 / 1.1.3 (kept for the record).
This document is in Chinese.

本文件记录**已经确认过**的缺陷：现象 → 怎么复现 → 根因 → 怎么修的 / 打算怎么修。
上面几条还没修；下面「已修复」一节留着存档，免得以后又踩回去。

判断某个问题有没有修，最直接的办法是看包内那几个文件的**字节大小**（下面每条都写了）。

---

## KI-4 Windows 会提示「已保护你的电脑」（SmartScreen）

- **不是 bug，是没买代码签名证书的必然结果**，写在这里免得当成故障排查。
- 用户侧：点「更多信息」→「仍要运行」；想核对文件完整性就用 Release 页上每个版本附带的 `.sha256`，
  或直接看 `docs/release-notes-<版本>.md` 里的表格。
- 彻底解决要买 Authenticode 证书（或走 Azure Trusted Signing / SignPath Foundation 这类对开源免费的路子），
  见 `docs/code-signing.zh-CN.md`。

## 已知但属于「设计如此」，不算缺陷

- **没有开机自启、没有自动更新**：要自启就把桌面快捷方式拖进 `shell:startup`；升级方式见 README 的
  「Updating to a newer version」（控制台里的一键更新排在 1.2.0）。
- **GitHub 仓库页显示 `NOASSERTION`**：`LICENSE` 里有两段版权（上游 + 本项目），GitHub 认不出标准模板，
  不改 `LICENSE`。
- **包内文件名与文案仍是中文**：改名要重打包，攒到下一个版本一起做。

---

## 已修复

### KI-1（v1.1.1 修复）便携版 `安装.cmd` 会「一闪而过」，什么提示都没有

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包（`cute-fat-fish-pet-<版本>-win-x64.zip`）；
  `setup.exe` 安装程序不受影响。
- **现象**：解压后双击 `安装.cmd`，黑色命令行窗口闪一下就没，像什么都没发生；桌面上什么都不会多出来。
- **根因**：旧 `assets\安装.cmd`（285 B）只有一层判断 —— 跑 PowerShell，然后 `if errorlevel 1` 才 pause。
  而当 `install.ps1` 不存在时（最常见的情形：**没解压，直接在压缩包预览窗口里双击了 `安装.cmd`**），
  Windows PowerShell 的行为是**打印一行提示到 stderr、然后以退出码 0 退出**：

  ```
  cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File C:\definitely-missing\install.ps1 & echo [errorlevel=%errorlevel%]"
  → The argument '...' to the -File parameter does not exist. ...
  → [errorlevel=0]
  ```

  退出码 0 ⇒ `if errorlevel 1` 不成立 ⇒ **不 pause** ⇒ 窗口立刻关闭，用户看不到任何原因。
- **复现（旧版）**：把旧 `安装.cmd` 单独复制到一个空文件夹（不放 `install.ps1`），双击它。
- **修法（1.1.1）**：`assets\安装.cmd` 285 B → **3,941 B**：
  1. `cd /d "%~dp0"` 之后先用 `if not exist` 检查 `install.ps1`、`electron\electron.exe`、`app\package.json`
     （卸载版查 `uninstall.ps1`）；
  2. 缺件时用 `powershell -EncodedCommand <base64>` 打印一段中文说明（「压缩包没有完整解压」+ 两种正确做法），
     不依赖当前代码页，然后 `exit /b 1`；
  3. 正常路径记下 `%ERRORLEVEL%`，**无条件 `pause`**，最后 `exit /b %RC%`；
  4. 全程纯 ASCII、无 BOM、LF 换行。

### KI-2（v1.1.1 修复）便携版装出来的名字和版本还是旧的

- **影响版本**：v1.1.0 的绿色 zip 包（`setup.exe` 不受影响）。
- **现象**：用 zip + `安装.cmd` 装完之后，桌面快捷方式叫「**蓝毛小女仆**」，「设置 → 应用」里登记的版本是「**1.0.0**」。
- **根因**：包内 `assets\install.ps1`（9,284 B）里的两行常量没跟着产品走：

  ```powershell
  $DisplayName = "蓝毛小女仆"
  $Version    = "1.0.0"
  ```

  它们被用来创建快捷方式、写注册表卸载项的 `DisplayName` / `DisplayVersion` / `Publisher`。
- **复现（旧版）**：用旧 zip 装一次，看桌面快捷方式名字与
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid`。
- **修法（1.1.1）**：`install.ps1` 9,284 B → **11,085 B**：
  - `$DisplayName = "可爱大肥鱼桌宠"`（与安装器 `build\installer.nsi` 的 `APP_NAME` 完全一致）；
  - `$Version` 不再写死，从包内 `app\package.json` 的 `version` 读（读不到才退回 `0.0.0`）；
  - `Publisher` 与安装器的 `APP_PUB` 同一串；缺件提示里补上「先右键 zip →『全部解压缩…』」的说明。
- **顺带修好**：`uninstall.ps1` 5,221 B → **5,543 B**（`$DisplayName` 同步改名）。
  另外，装新版时若桌面上还留着旧名的「蓝毛小女仆」快捷方式、并且它指向这次装的目录，
  就把它改名成 `…lnk.bak-<时间戳>` 留档（不留两个图标）；`uninstall.ps1` 也会清掉指向本安装目录的旧名快捷方式。
- **注意**：`$AppName = "BlueHairMaid"` 与注册表键名**是内部标识，必须保持不变**（见 `NOTICE.md` 第 5 节）。

### KI-3（v1.1.1 修复）`安装.cmd` 里的中文 + `chcp 65001` 会让批处理解析出错

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包。
- **现象**：运行旧 `安装.cmd` 时，命令窗口里会多出几条莫名其妙的报错：

  ```
  '蓝毛小女仆' is not recognized as an internal or external command
  'onPolicy' is not recognized as an internal or external command      ← 其实是 -ExecutionPolicy 被吃掉了一半
  '安装没成功]' is not recognized as an internal or external command
  ```

- **根因**：`.cmd` 文件本身是 UTF-8（无 BOM）且含中文，第 2 行又执行了 `chcp 65001`；`cmd.exe` 按字节解析批处理，
  在代码页切换与多字节字符混在一起时会把后面的行切错（和 `.vbs` 必须写成纯 ASCII 是同一类坑）。
- **修法（1.1.1）**：两个 `.cmd` 现在都是**纯 ASCII、无 BOM、LF 换行**，
  中文提示全部由 PowerShell 打印，并且提示语是用 `-EncodedCommand <base64>` 传进去的，任何代码页都不会乱码。
- **教训**：`.cmd` / `.vbs` 这类「由 Windows 外壳自己解析」的脚本一律写成纯 ASCII；
  中文只放在 PowerShell 脚本、README 和控制台输出里。

### KI-5（v1.1.1 修复）便携版卸载完了，安装目录却整个还在

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包（只有 zip 里有 `卸载.cmd`；`setup.exe` 用的是 NSIS 自带卸载器，不受影响）。
- **现象**：卸载跑完，日志最后一行是
  `[!] 还有文件删不掉（可能被占用），请手动删除：D:\...`，而安装目录里 **714 个文件一个都没少**。
- **根因**：卸载时 `cmd.exe` 的**当前目录就是安装目录**（Explorer 双击脚本时，CWD = 脚本所在目录），
  而且它正在读取这个目录里的 `卸载.cmd` 自己。Windows 既不允许删除「正被某进程当作当前目录」的目录，
  也不允许删掉 cmd 正在读的批处理文件 ⇒ `Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue`
  在 Windows PowerShell 5.1 下**整体失败**；又因为带了 `-ErrorAction SilentlyContinue`，失败是静默的。
- **证据**：在没有进程占用这棵树的前提下，用同一句命令手动删同一个安装目录 → `错误输出条数：0`、目录消失
  ⇒ 树本身完全可删，问题出在「卸载器自己就在里面跑」。对照实验里，外部 `pwsh` 删一个「有 cmd 停在里面」的目录
  也能删掉，说明单独一个 CWD 不挡删除，是 **CWD + 正在打开着的 `.cmd`** 一起造成的。
- **修法（1.1.1，两个文件）**：
  1. `assets\卸载.cmd` 1,086 B → **1,298 B**：不再 `cd /d "%~dp0"`，改成 `cd /d "%TEMP%"`（失败则退回 `%SystemRoot%`），
     卸载器的当前目录永远不停在安装目录里；仍然是纯 ASCII、无 BOM、LF 换行，仍然无条件 `pause`。
  2. `assets\uninstall.ps1` 5,543 B → **8,191 B**：删目录前先 `Set-Location -LiteralPath $env:TEMP` 并把
     `[Environment]::CurrentDirectory` 也挪出去；最多 3 轮重试，每轮**只删安装目录顶层扩展名不是 `.cmd` 的东西**
     （删掉正在运行的 `卸载.cmd` 会让 cmd 读不下去：实测日志末尾会出现 `系统找不到指定的路径。`，最后的暂停提示也消失）；
     目录清空就删目录；如果只剩那几个 `.cmd`，就起一个**隐藏的分离助手进程**（`powershell -EncodedCommand`），
     等这个窗口（父 cmd 进程）退出之后再删，最多重试 150 × 800 ms，并在窗口里提示
     「安装目录里只剩这个窗口自己在用的几个 .cmd，已安排：窗口一关就自动清掉。」
- **验证**：在新 zip 上跑完整「解压 → 安装 → 卸载」：卸载日志出现新提示 + `卸载完成。` + `请按任意键继续. . .`，
  **窗口退出后第 2 秒整个安装目录消失**（助手进程生效），注册表登记项已清、用户数据保留。

### KI-6（v1.1.2 修复）联网模型把「思考过程」整段当台词念出来

- **影响版本**：v1.1.0 / v1.1.1（1.0.0 的包里没有 `standalone\online.json`，联网那条路实际用不起来），条件是控制台
  「联网模型」里配了**思考型**端点 —— 默认填的就是 DeepSeek 的地址，所以照默认配好就会中。
- **现象**：聊天时她的回答是一大段推理文字（「我们需要回答用户…」「用户要求只回两个字，所以…」），而不是一句话。
- **根因**：`deepseek-flash` / `deepseek-v4-pro` 都是**思考型**模型：先输出一段独立的 `reasoning_content`，再写正文。
  桌宠要的是 20~40 字的短句，预算给得小 —— 实测 **20 token 预算下正文 0 字、思考 556 字**（`finish_reason=length`），
  正文直接是空的。而 `standalone\online.mjs` 遇到「正文为空」时会**退而把 `reasoning_content` 当回答**，思考就成了台词。
- **证据**：同一句「只回两个字：在的」原样发 → `content=''`、有 `reasoning`、预算全烧完；
  请求体加 `"thinking":{"type":"disabled"}` → `content='在的'`、**2 个 token**、无 `reasoning`（`deepseek-v4-pro` 同样）。
  真实短句场景：原样（预算 400）→ 正文空、思考 556 字；关思考 → 「辛苦啦，快靠过来，我给你充充电～」11 个 token。
- **修法（1.1.2，`standalone\online.mjs` 三处）**：
  1. 新增 `thinkingOff(baseUrl, model)`：目标是 `api.deepseek.com` 时给请求体加 `"thinking":{"type":"disabled"}`
     （`reasoner` 类不加；别的 OpenAI 兼容端点不发这个字段，避免未知字段被服务端拒绝）。
  2. 「只有思考、没有正文」改成**如实报错**（`reason: "thinking-only"`，提示「联网模型只想了、没写正文：把预算调大，
     或在控制台换一个不思考的模型」），**绝不把 `reasoning_content` 当台词** —— 与本地那条路保持一致
     （`app/lib/index.js:431`、helper 的 `pet:local-quip` 只回错误码）。
  3. `toOpenAIMessages` 也接受**纯字符串** `content`（以前只认数组形状，传字符串会被静默变成空 prompt，模型于是答非所问）。
- **验证**：`node --check` 通过；用改后的代码真调（临时把用户的 `online.json` 放进仓库 `standalone\`，测完即删）：
  `onlinePing` → 「在的」；带人设 `system` + 数组形状 → 「主人早安呀～今天也要元气满满哦！✨」；纯字符串形状 → 「你真是独一无二的闪光存在！」。
- **顺带记录（不是本版引入）**：那个 DeepSeek 端点偶发返回与提问无关的内容（测试期间撞到两次，与密钥/请求无关）。

### KI-7（v1.1.3 修复）「打开 X」只认网址和软件：开不了文件夹/文件，A 站这类站点名也不认

- **影响版本**：v1.0.0 ~ v1.1.2（这条路从 1.0.0 起就是这个行为，用户 1.1.3 开发期间报的）。
- **现象**：说或打「打开 A站首页」没反应；「打开 下载文件夹」「打开 报告.docx」会被当成软件名去找，
  最后回一句「没找到」。只有 `http://…` / `www.…` 开头的网址、以及能对上开始菜单/桌面快捷方式的软件名能走通。
- **根因**：渲染端 `runtime/electron-helper/sprite.js` 的 `onChatSendIntercept` 里只有**两个桶** ——
  `isUrl()` 只认 `^https?://` / `www.` 或一张小 TLD 表，其余一律 `kind='app'`；主进程 `pet:open-target`
  也没有「本机文件夹/文件」这条分支（只有 url 与软件解析）。权限文案里虽然早就有第三个 `file`，
  但没有任何代码会走到它。
- **修法（1.1.3）**：
  1. 新增纯逻辑文件 `runtime/electron-helper/targets.js`（浏览器挂 `window.DshPetTargets`，node 下 `module.exports`）：
     `classify(text)` 把「打开」后面那串字判成 `url` / `file` / `app` 三类，顺序是 **网址 → 本机路径 → 盘符 →
     系统文件夹令牌 → 站点别名 → 软件兜底**；另有 `siteUrl()`、`folderToken()`、`driveRoot()`、`looksLikePath()`、`searchUrl()`。
     站点别名是人工表（A站/acfun、B站/bilibili/小破站、知乎、微博、百度、贴吧、淘宝、天猫、京东、拼多多、豆瓣、
     抖音、快手、小红书、腾讯视频、爱奇艺、优酷、网易云音乐、QQ音乐、维基百科、必应、GitHub、YouTube、Twitter、Facebook）；
     刻意**不写** steam 与「音乐」（否则「打开蒸汽」会从开客户端变成开网页、「打开音乐」会从开软件变成开文件夹）。
  2. `sprite.js`：新增 `normOpenText()`（削句尾语气词、去掉开头「请/麻烦/劳驾」、把「帮我把 B站 打开」改写成「打开 B站」）
     与 `parseSearchIntent()`（「百度一下 / 搜一下 / 查一下 X」→ 结果页，默认必应、说了百度用百度）；
     `parseIntent` 的原正则**一个字没改**（避免碰坏已有的口语适配）；解析后调 `classify` 得到 kind 并走对应的
     `this.perm[kind]` 闸门；`execOpen` 新增 `file` 分支（成功回「好，帮你打开「X」了～」、`ambiguous` 只问不做、
     `not-found` 回「我没找到叫「X」的文件夹或文件…」）。
  3. `main.js`：`pet:open-target` 增加 `kind:'file'` → `openLocalTarget()`：文件夹令牌走 `app.getPath()`；
     盘符 / 绝对路径走 `fs.existsSync` + `shell.openPath`；光给一个名字就在 桌面 / 下载 / 文档 / 图片 / 视频 / 音乐
     **顶层**只读 `readdirSync` 做双向包含匹配，**刻意跳过 `.lnk` / `.url` / `.exe` / `.bat` / `.cmd`**
     （那些是软件，走 app 那条路 —— 免得只有 file 权限反而把软件拉起来）；命中多个只问不做。
     全程只 `shell.openPath` / `shell.openExternal`：不删除、不移动、不改名、不写文件。
  4. `index.html` 在 `constants.js` 之后、`sprite.js` 之前挂上 `targets.js`；四个 `package.json` 与
     `build\installer.nsi` 的 `!define APP_VER` 升到 1.1.3；`build\check-release.mjs` 的关键文件清单加入 `targets.js`。
- **验证**：离线回归 `_accept\test-voice-targets.cjs` **72 项断言全过**（分类 31 条 + 路由/权限/录屏优先/文案 41 条）；
  真渲染端 CDP 断言 `_accept\test-voice-live.cjs` **21 项全过**（含真主进程落地 `openLocalTarget` 开窗）；
  包内自检（拖拽、穿透、菜单、动画、webm、errors）全过；数字见下面「1.1.3 的验收」。

### 修复验证

- `安装.cmd` / `卸载.cmd`：本机冒烟（缺文件路径）实测退出码 1、中文说明逐字正确、`pause` 生效。
- `install.ps1` / `uninstall.ps1`：Windows PowerShell 5.1 `Parser::ParseFile` 解析通过（两个都带 UTF-8 BOM）。
- **安装侧真机（绿色 zip）**：解压新 zip（714 个文件 / 797,858,981 B）→ 双击 `安装.cmd` 真装一次 →
  `python build\verify-install.py stage <安装目录>` **包内该装的 710 个文件逐字节一致（797,834,466 B）**；
  注册表 `DisplayName=可爱大肥鱼桌宠`、`DisplayVersion=1.1.1`、`UninstallString` 指向该目录的 `卸载.cmd`。
- **安装侧真机（setup.exe）**：静默装进空目录（711 个文件 = 该装的 710 个 + 安装时生成的 `Uninstall.exe`）→ 同样
  **710 个文件逐字节一致（797,834,466 B）**、`DisplayVersion=1.1.1`；装出来的 `verify.mjs` 在安装树里自校验 `exit 0`；
  跑 `<安装目录>\Uninstall.exe /S` → 安装目录、登记项、桌面与开始菜单快捷方式都被清掉，`%APPDATA%\BlueHairMaid` 用户数据保留。
- **卸载侧真机**：跑安装目录里的 `卸载.cmd` → 安装目录被完整清掉（见 KI-5），快捷方式与登记项清掉，`%APPDATA%\BlueHairMaid` 用户数据保留。
- **发布门禁**：`node build\check-release.mjs`、`python build\nsi-syntax-check.py`、`python build\mkzip.py`、`python build\mkexe.py` 全部通过；
  包内自带的 `verify.mjs` 在发布树里自校验通过。

### 1.1.2 的验收（2026-10-09）

- **发布门禁**：`node build\build.mjs app launcher standalone`（隐私门禁 `check-paths.mjs` 扫 181 个文件干净）→
  `node build\check-release.mjs --emit --write` → `node build\build.mjs verify` → `node build\check-release.mjs`（全部通过：
  app 593 / launcher 9 / standalone 14 / defaults 4 / assets 7 全对齐，运行期残留 0）→ `python build\nsi-syntax-check.py`（通过）。
- **绿色 zip 真机**：用发布的那份 zip 解压（714 个文件 / 797,860,676 B）→ 双击 `安装.cmd` 真装一次（4.2 秒，日志以
  `[ok] Setup finished.` + `请按任意键继续. . .` 结束）→ `python build\verify-install.py stage <安装目录>`：
  **包内该装的 710 个文件逐字节一致（797,836,161 B）**；注册表 `DisplayName=可爱大肥鱼桌宠`、`DisplayVersion=1.1.2`、
  `UninstallString` 指向该目录的 `卸载.cmd`。
  （这条路线 `verify-install.py` 会报 `exit=1`：它把 zip 里那 4 个便携脚本 `安装.cmd` / `卸载.cmd` / `install.ps1` /
  `uninstall.ps1` 当成「多出来的文件」—— 而这 4 个本来就该留在安装目录里，属于工具口径问题，不是安装缺陷；
  安装器那条路不含这 4 个，`exit=0`。）
- **卸载侧真机**：跑安装目录里的 `卸载.cmd`（4.5 秒）→ 提示「安装目录里只剩这个窗口自己在用的几个 .cmd，已安排：窗口一关就自动清掉。」
  → **安装目录整个消失**、登记项清掉、桌面与开始菜单里指向测试目录的快捷方式清掉、`%APPDATA%\BlueHairMaid` 用户数据保留。
- **安装器真机**：新 exe 静默装进空目录（54 秒，711 个文件 / 798,092,111 B = 该装的 710 个 + 安装时生成的 `Uninstall.exe`）→
  **710 个文件逐字节一致（797,836,161 B）**、`DisplayVersion=1.1.2`；装出来的 `verify.mjs` 在安装树里自校验 `exit 0`；
  跑 `<安装目录>\Uninstall.exe /S`（6 秒）→ 安装目录与登记项都清掉，用户数据保留。
- **联网模型真调**：见 KI-6 的「验证」——改后的代码真调三次（`onlinePing` / 带人设数组形状 / 纯字符串）都对。
- **主人的机器已还原**：测试前把要动的部分整份快照（`_accept\user-state-112\`：两个 `HKCU` 键 + 桌面与开始菜单的快捷方式），
  跑完按快照还原并删掉测试留下的重复 `.lnk.bak` —— 桌面与开始菜单的「可爱大肥鱼桌宠」快捷方式仍指向主人的安装目录、
  `HKCU` 的 11 个值原样（`InstallDir` = 安装目录、`DisplayVersion` 记的是最后一次装上的版本号）、测试目录已删除。

### 1.1.3 的验收（2026-10-09）

- **改前的离线证据**：`_accept\test-voice-targets.cjs` **72/72 条断言通过**（31 条分类 + 16 条路由 + 普通聊天不拦截 +
  三个权限开关各拦各放 + 录屏优先 + ambiguous/not-found 文案 + `openLocalTarget` 对真临时目录的令牌/盘符/绝对路径/
  唯一相对名/重名只问不做/跳过 `.lnk`）。helper 目录此前一个测试文件都没有。
- **真渲染端（CDP）**：`_accept\run-voice-live.cjs` 起一个隔离实例（临时 `DSH_HOME` + 临时 `--user-data-dir`，
  不碰主人的控制口），`_accept\test-voice-live.cjs … --open-real` → **21/21 条断言通过**：`targets.js` 已挂载、
  `classify` 七例、五句载荷（url / file / auto）、「搜一下今天的天气」走必应、普通聊天不拦截、权限关着不发载荷且文案含
  「权限」，以及**真主进程**落地：`openLocalTarget('downloads')` → `{ok:true,matched:'下载'}`、
  `%TEMP%` 绝对路径 → `{ok:true,matched:'Temp'}`、乱编的名字 → `{ok:false,error:'not-found'}`。
- **包内自检（顺手修掉一个假阴性）**：`DSH_PET_SMOKE=1` 的专用实例 dump 全过（`errors:[]`、`configOk:true`、
  `spriteCount:1`、拖拽/穿透/动画 webm 与 1.1.2 基线逐项一致）。唯一差异是 `menuSmoke.menuMounted` 两份都是 `false` ——
  查下去不是回归，而是自检自己太急（右键菜单要先 `await fetchWatchState()`（≤2.5 s）再 `await textModelMenuInfo()`（≤1.2 s）
  才挂上）。改成轮询等待后 `menuMounted:true waitedMs:200 panelCount:35 lvl2AfterHoverRoot:2 errsNew:0`。
- **发布门禁**：`node build\build.mjs --toolchain 'D:\测试\BlueHairMaid'`（隐私门禁 `check-paths.mjs` 扫 182 个文件干净）→
  暂存树 app 594 / launcher 9 / standalone 14 / defaults 4 / assets 7 / electron 75 / node 3 / speech 8（+ `verify.mjs`
  共 **715 个文件**）→ `node build\check-release.mjs --emit --write`（重写 `verify.mjs` 的 3.3 KB 生成段；**新增
  `app/runtime/electron-helper/targets.js` 进关键文件表**）→ `node stage\verify.mjs`（**4 棵树的整树指纹 + 26 个关键文件
  全部一致**）→ `python build\nsi-syntax-check.py` → `mkzip` → `mkexe`，全部通过。
- **绿色 zip 真机**：`cute-fat-fish-pet-1.1.3-win-x64.zip` = **417,001,082 B**（`5BAB9574…FEF790A21`，715 个文件）；
  解压（19.4 秒）→ 715 个文件 / 797,880,210 B → 解压树里 `node verify.mjs` **exit 0**（整树指纹一致）→ `安装.cmd`
  真装一次（3.5 秒，日志以 `[ok] Setup finished.` + `请按任意键继续. . .` 结束）→ `python build\verify-install.py stage <目录>`：
  **包内该装的 711 个文件逐字节一致（797,855,695 B）**，`exit=1` 只因 zip 里那 4 个便携脚本
  （`安装.cmd` / `卸载.cmd` / `install.ps1` / `uninstall.ps1`）本来就该留在安装目录里（同 1.1.2 记录的工具口径问题）；
  登记项 `DisplayName=可爱大肥鱼桌宠`、`DisplayVersion=1.1.3`、`UninstallString` 指向该目录的 `卸载.cmd`；
  `卸载.cmd`（5.4 秒）后安装目录消失、登记项清掉、指向测试目录的快捷方式清掉、`%APPDATA%\BlueHairMaid` 用户数据保留。
- **安装器真机**：`cute-fat-fish-pet-1.1.3-setup.exe` = **347,865,488 B**（`88A64CF8…76A1202D`，NSIS 3 LZMA，打包 1240 秒）；
  静默装进空目录（80 秒，712 个文件 / 798,111,645 B = 该装的 711 个 + 安装时生成的 `Uninstall.exe`）→
  **711 个文件逐字节一致**、`verify-install.py exit=0`、`DisplayVersion=1.1.3`；`Uninstall.exe /S`（2 秒）→
  安装目录与登记项都清掉、桌面快捷方式数回落到装前的 3 个、`%APPDATA%\BlueHairMaid` **69 个文件 / 4,935,784 B 一字未动**。
- **主人那份真升级**（1.1.2 → 1.1.3，就是上面那个 exe）：先停掉在跑的桌宠与控制台 → `setup.exe /S /D=D:\测试\BlueHairMaid`
  （76 秒）→ **713 个文件 / 798,111,880 B**，`verify-install.py`：**711 个文件逐字节一致（797,855,695 B）**，
  唯一「多出来」的是她自己的 `standalone\online.json`（联网模型配置，属于要保留的用户数据）→
  登记项 `DisplayVersion` 由 1.1.2 变成 **1.1.3**、`InstallLocation` 与 `InstallDir` 仍指向 `D:\测试\BlueHairMaid` →
  按控制台自己的方式把桌宠重新拉起来：运行器 `standalone\main.mjs` + 桌面 helper `app\runtime\electron-helper\main.js`
  都起来了，运行日志里 `control bridge: http://127.0.0.1:3099`、`displays: 2560x1440 … petScale=1.5`、无报错，
  控制台窗口也在。
- **测试前快照 / 跑完还原**：`_accept\user-state-113\`（两个 `HKCU` 键 + 桌面与开始菜单快捷方式），两次真机安装跑完
  按快照还原：主人的登记项（`DisplayVersion=1.1.2`、`InstallLocation=D:\测试\BlueHairMaid`）与桌面 4 个 `.lnk` 原样，
  测试目录 `D:\_test113-install` / `D:\_test113-zip` 与 `_accept\Programs\BlueHairMaid113` 都还在仓库外、不随版本发布。
- **一个只有本会话才会遇到的小坑**（写下来免得下次又踩）：本会话的环境里带着 `ELECTRON_RUN_AS_NODE=1`，
  直接 `Start-Process` 拉控制台会静默退出（Electron 被当成纯 node 跑，`launcher` 当脚本路径报错）；
  清掉这个变量再拉就正常。主人自己双击快捷方式不受影响。
