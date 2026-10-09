# Known issues

English summary: defects that were confirmed in shipped builds, with the reproduction, the root cause
and how they were fixed. Open items come first, then the ones fixed in 1.1.1 / 1.1.2 / 1.1.3 / 1.1.4 / 1.2.0 (kept for the record).
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

- **没有开机自启**：要自启就把桌面快捷方式拖进 `shell:startup`。**也没有后台自动检查更新**（它不会自己偷偷联网），
  但控制台里从 1.2.0 起有一个「检查更新 + 下载并更新」的按钮，点一下就能升级完；升级方式见 README 的
  「Updating to a newer version」。
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

### KI-8（v1.1.4 修复）控制台把 API Key 明文摆在屏幕上（录视频会拍到）

- **影响版本**：v1.0.0 ~ v1.1.3（控制台从 1.0.0 起就是纯文本输入框 + 原样回显日志）。
- **现象**：「联网模型」里的两个 Key 输入框是 `type="text"`，一打开就是明文；任何把 Key 打出来的日志行也是明文；
  页脚的数据路径与「本机适配」日志里还带着 `C:\Users\<用户名>\…`。录宣传视频时会一起被拍进去。
- **根因**：控制台 `launcher\index.html` 既没有隐藏态（两个框都是 `type="text"`），也没有输出脱敏层 ——
  `log()` / `setupLine()` 直接 `textContent = 原文`，`#permLog`、`#footRoot` / `#footData` 同理。
- **修法（1.1.4，只动 `launcher\index.html` 一个文件）**：
  1. 两个 Key 框改成 `type="password"`（带 `autocomplete="off" spellcheck="false"`），各配一个「显示 / 隐藏」按钮；
     新增 `.eye` 样式，并把基础输入框选择器扩成 `select, input[type=text], input[type=number], input[type=password]`
     （否则 password 框没样式、没 `flex:1`）；「输入过就算 dirty」的选择器也补上 `input[type=password]`。
  2. 新增 `secretValues()`（读出两个框里 ≥6 字符的密钥）与 `maskSecrets(text)`：把**保存的真密钥整串**换成 `••••••`、
     `sk-[A-Za-z0-9_\-]{4,}` → `sk-••••••`、`(Bearer\s+)[A-Za-z0-9._\-]{6,}` → `$1••••••`（幂等）。除这三种密钥形状
     以外一律不动 —— 路径、用户名、普通文字原样输出。
  3. `log()`、`setupLine()`、`#permLog`、`#footRoot` / `#footData` 一律 `textContent = maskSecrets(原文)`，**没有开关**：
     控制台从写出去那一步起就不再打印它知道的密钥（输入框当前是显示还是隐藏都一样）。
  4. `applySecretVisibility()` + 两个 `.eye` 按钮：平时是 `type="password"`，点「显示」才变 `text`，两个框互不影响。
     第一版曾顺手加了「录制模式」总开关 + `● 录制中` 角标 + `localStorage`，主人当天明确「只需要能主动隐藏
     API Key 的功能，不要加录制什么的」⇒ **已整条删掉**（页面上既没有 `#privacyMode` / `#privacyBadge`，也不写 `localStorage`）。
- **验证**：真渲染端 CDP `_accept\test-console-privacy.cjs` **26 项断言全过**（默认就是圆点、Key 真从 `online.json` 填进来、
  显示/隐藏互不影响、页面上没有录制模式残留、终端/适配日志/权限日志脱敏、普通文字原样）；数字见下面「1.1.4 的验收」。

### KI-9（v1.2.0 修复）一键更新「下载成功」，可安装包是 0 字节

- **影响版本**：只在 1.2.0 的开发期存在过（第一版 `launcher\update.js`）；**从未发布** —— 离线自检在打包之前就抓到了。
- **现象**：`download()` 返回成功，进度条也走到 100%，算出来的 SHA-256 还跟发布里给的摘要**一致**，但磁盘上那个
  `.part` 文件是 **0 字节**。真去装只会失败，而且"校验通过"这件事会让人以为文件是好的。
- **根因**：流式下载那段只顾着把收到的数据喂给哈希器（`hash.update(chunk)`），**忘了写盘**（`ws.write(chunk)`
  根本没写）。哈希算的是同一串内存数据，两边自洽，所以"下完了、校验过了"这条路一直是绿的。
- **修法**：`ws.write(chunk)` 加上背压处理
  （`if (!ws.write(chunk)) { res.pause(); ws.once("drain", () => res.resume()); }`）；顺手补了
  `res.on("aborted")` 和 `res.on("close") { if (!res.complete) … }` —— 原来对方中途掐连接时 `download()` 会永远不返回。
- **验证**：`_accept\test-update.cjs` 里那组 `download()` 断言现在真的从 127.0.0.1 上的假 GitHub 下 256 KB 下来，
  比字节、比哈希、比"不留 `.part`"、比进度最后是 100% —— 现在 97 项断言全过（见下面「1.2.0 的验收」）。
- **教训**：自检必须**去看磁盘上的结果**，不能只看函数返回值 —— 和 KI-1 / KI-5 那几条一个道理。

### KI-10（v1.2.0 修复）点完「下载并更新」窗口关掉了，然后什么都没发生

- **影响版本**：只在 1.2.0 的开发期存在过；**从未发布** —— 真机端到端在打包之前就抓到了。
- **现象**：点「检查更新」有新版、点「下载并更新」进度走到 100%、窗口按约定自己关掉；然后就**没有然后了**：
  版本还是旧的、`<数据根>\updates\update-1.2.0.log` 是 **0 字节（一行都没写）**、347 MB 的安装包也没被清掉。
  但控制台写出来的 `apply-update.ps1`、安装包、下载好的 exe 都在，看起来一切"交班成功"。
- **根因**：`apply()` 是用 `spawn(powershell.exe, …, { detached: true, stdio: "ignore", windowsHide: true })` 起那个脚本的。
  `detached: true` 在 Windows 上就是 `DETACHED_PROCESS`（没有控制台），而 **`powershell.exe` / `cmd.exe` 这类控制台程序
  在没有控制台时会立刻以退出码 0 结束、什么都不做** —— 本机实测：同一段探针脚本，同步跑能写出日志，
  detached 跑时子进程立刻 `exit 0` 且日志为空；换成 detached 起 `node.exe` 却一切正常 ⇒ 不是"本环境一律杀 detached"，
  是"控制台程序没控制台就退出"。所以不是权限、不是路径、不是执行策略的问题，脚本第一句都没轮到跑。
- **修法**：多一层 `apply-update.vbs` 启动器（**纯 ASCII**，用 `WScript.ScriptFullName` 找到自己所在目录、再去跑同目录的
  `apply-update.ps1`），改成 `spawn(wscript.exe, ["//nologo", vbs], { detached: true, … })`。`wscript.exe` 是 GUI 程序，
  detached 起得来、也能活过控制台自己退出，`sh.Run …, 0, False` 让 PowerShell 隐藏着跑且不等它。
  ps1 正文一个字没改，只是收工时会把这个启动器一起删掉。VBS 的路径**不写死**（中文用户名 / 带空格的目录都不用担心编码），
  起不来时会在 `updates\` 里留一张 `apply-vbs-error.txt` 纸条。
- **验证**：新写的 `_accept\_probe\vbs-handoff.cjs` 用**假安装目录 + 假安装程序**（一个 `exit /b 0` 的 .cmd）真跑整条交班链 ——
  日志 8 行齐全（等控制台 PID 退出 → `/S /D=…` → 退出码 0 → 清理 → 写结果 → 把控制台开回来）、
  `last-result.txt` 写出 `ok=1 / exit=0 / from=1.1.4 / to=1.2.0`、假安装包被删、`apply-update.ps1` 与 `.vbs` 自己删掉；
  另外单独验过"启动器先退出、PowerShell 继续把 3 秒的活儿干完"（子进程活过父进程）。
  随后真机端到端（真装 1.2.0）也走通，见下面「1.2.0 的验收」。
- **教训**：**跨进程交接没法用"返回值成功"来证明** —— 必须让真正干活的子进程把日志写出来，再看那份日志。

### KI-11（v1.2.0 修复）装完了清不掉那两个中文名的便携脚本

- **影响版本**：只在 1.2.0 的开发期存在过；**从未发布**。
- **现象**：更新装完，`install.ps1` / `uninstall.ps1` 被清掉了，可同一个安装目录里的 `安装.cmd` / `卸载.cmd` 还留着
  （上面那条假交班链实测：日志只打了前两个「清掉旧脚本」，后两个一声不响）。
- **根因**：脚本为了避开编码问题，用 `@([char]0x5B89 + [char]0x88C5 + '.cmd', [char]0x5378 + [char]0x8F7D + '.cmd')`
  去拼这两个名字。PowerShell 里 **`@()` 中那个逗号比 `+` 结合得更紧**：先把 `'.cmd', [char]0x5378` 组成数组，
  再被 `+` 当字符串拼（数组用空格 join）⇒ 实际拿到的是**一个**字符串 `"安装.cmd 卸载.cmd"`，`Test-Path` 永远 false。
- **修法**：直接写字面量 `@('安装.cmd', '卸载.cmd')` —— ps1 是 UTF-8 带 BOM 写盘的，PS 5.1 认这些中文
  （脚本里本来就到处是中文字面量，日志里中文一直是好的）。顺手在离线自检里加了一条"不许再出现 `[char]0x`"的断言。
- **验证**：同一条假交班链重跑，日志出现 **4 行**「清掉旧脚本」（含两个中文名），安装目录里只剩 `electron\` / `launcher\`。
- **教训**：**表达式被静默拼错，解析器是查不出来的** —— 那个 3874 字符的 ps1 `Parser::ParseFile` 报 0 个错误，
  只有真跑一遍才会发现少删了两个文件；`@(a + b, c + d)` 这种地方宁可直接写字面量或加括号。

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
- **发布门禁**：`node build\build.mjs --toolchain 'D:\...\BlueHairMaid'`（隐私门禁 `check-paths.mjs` 扫 182 个文件干净）→
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
- **主人那份真升级**（1.1.2 → 1.1.3，就是上面那个 exe）：先停掉在跑的桌宠与控制台 → `setup.exe /S /D=D:\...\BlueHairMaid`
  （76 秒）→ **713 个文件 / 798,111,880 B**，`verify-install.py`：**711 个文件逐字节一致（797,855,695 B）**，
  唯一「多出来」的是她自己的 `standalone\online.json`（联网模型配置，属于要保留的用户数据）→
  登记项 `DisplayVersion` 由 1.1.2 变成 **1.1.3**、`InstallLocation` 与 `InstallDir` 仍指向 `D:\...\BlueHairMaid` →
  按控制台自己的方式把桌宠重新拉起来：运行器 `standalone\main.mjs` + 桌面 helper `app\runtime\electron-helper\main.js`
  都起来了，运行日志里 `control bridge: http://127.0.0.1:3099`、`displays: 2560x1440 … petScale=1.5`、无报错，
  控制台窗口也在。
- **测试前快照 / 跑完还原**：`_accept\user-state-113\`（两个 `HKCU` 键 + 桌面与开始菜单快捷方式），两次真机安装跑完
  按快照还原：主人的登记项（`DisplayVersion=1.1.2`、`InstallLocation=D:\...\BlueHairMaid`）与桌面 4 个 `.lnk` 原样，
  测试目录 `D:\_test113-install` / `D:\_test113-zip` 与 `_accept\Programs\BlueHairMaid113` 都还在仓库外、不随版本发布。
- **一个只有本会话才会遇到的小坑**（写下来免得下次又踩）：本会话的环境里带着 `ELECTRON_RUN_AS_NODE=1`，
  直接 `Start-Process` 拉控制台会静默退出（Electron 被当成纯 node 跑，`launcher` 当脚本路径报错）；
  清掉这个变量再拉就正常。主人自己双击快捷方式不受影响。

### 1.1.4 的验收（2026-10-09）

- **功能验证（真渲染端 CDP）**：`_accept\test-console-privacy.cjs` **26 项断言全过** —— 默认就是圆点（证明
  `standalone\online.json` → `doOptions` → `syncForm` → 输入框整条路都通）、点「显示」变明文且输入框里的值不变、
  两个框互不影响、页面上没有 `#privacyMode` / `#privacyBadge` 也没有 `localStorage` 开关残留、终端 / 适配日志 /
  权限日志里的真密钥与 `sk-…` / `Bearer …` 令牌都打点（明文正开着的时候也一样）、而路径与普通文字一个字都没改。
  隔离实例跑（临时 `DSH_PET_DATA_DIR`），跑完把测试用的 `standalone\online.json` 删干净（原本不存在）。
- **发布门禁**：`node build\build.mjs --toolchain D:\...\BlueHairMaid`（隐私门禁 `check-paths.mjs` 扫 **184 个文件干净**）→
  `node build\check-release.mjs --emit --write` → `node stage\verify.mjs`（**4 棵树的整树指纹 + 26 个关键文件全部一致**）→
  `node build\check-release.mjs` → `python build\nsi-syntax-check.py` → `mkzip` → `mkexe`，全部通过。
  暂存树 app 594 / launcher 9 / standalone 14 / defaults 4 / assets 7 / electron 75 / node 3 / speech 8（+ `verify.mjs`，
  共 **715 个文件**）。
- **门禁自己抓到的一次**（记下来，别再犯）：第一遍全量构建时门禁命中 2 处 —— 全在**刚写好的发布说明自己身上**
  （`docs\release-notes-1.1.4.md` 里引用了本机专属盘符目录当反面教材）。结论「2 处命中……先修掉再打包」，`exit 1`、
  暂存树没被动过。改成 `D:\...\BlueHairMaid` 这种既有的省略写法后干净。**任何文档里都不要出现那个字面量路径，哪怕是在讲它不能出现。**
- **绿色 zip 真机**：`cute-fat-fish-pet-1.1.4-win-x64.zip` = **417,002,153 B**（`54F6832C…CC9542FC`，715 个文件）；
  解压（13 秒）→ 715 个文件 / 797,882,748 B → 解压树里 `node verify.mjs` **exit 0**（整树指纹一致）→ `安装.cmd` 真装一次
  （2.9 秒，日志以 `[ok] Setup finished.` + `请按任意键继续. . .` 结束）→ `python build\verify-install.py stage <目录>`：
  **包内该装的 711 个文件逐字节一致（797,858,233 B）**，`exit=1` 只因 zip 里那 4 个便携脚本本来就该留在安装目录里
  （工具口径问题，不是安装缺陷）；登记项 `DisplayName=可爱大肥鱼桌宠`、`DisplayVersion=1.1.4`、`UninstallString` 指向该目录的
  `卸载.cmd`；`卸载.cmd`（4.3 秒）后安装目录消失、登记项清掉、指向测试目录的快捷方式清掉、`%APPDATA%\BlueHairMaid` 用户数据保留。
- **安装器真机**：`cute-fat-fish-pet-1.1.4-setup.exe` = **347,880,285 B**（`495F5D35…8553C5D0`，NSIS 3 LZMA，打包 563 秒）；
  静默装进空目录（52 秒，712 个文件 / 798,114,183 B = 该装的 711 个 + 安装时生成的 `Uninstall.exe`）→
  **711 个文件逐字节一致**、`verify-install.py exit=0`、`DisplayVersion=1.1.4`；`Uninstall.exe /S`（2 秒）→
  安装目录与登记项都清掉、桌面快捷方式数回落到装前的 3 个、`%APPDATA%\BlueHairMaid` **71 个文件 / 4,983,571 B 一字未动**。
- **主人那份真升级**（1.1.3 → 1.1.4，就是上面那个 exe）：先把她正在跑的桌宠停掉（4 个 `electron.exe`，`taskkill /PID <主进程> /T /F`）
  → `setup.exe /S /D=D:\...\BlueHairMaid`（55 秒；**静默模式不读注册表**，`.onInit` 第一行就是 `IfSilent oninit_done`，
  所以静默升级必须显式给 `/D=`）→ 安装目录 718 个文件 / 798,337,917 B，`verify-install.py`：**711 个文件逐字节一致
  （797,858,233 B）**，多出来的 6 个是她自己或录制期留下的（`standalone\online.json`、
  `app\runtime\electron-helper\main-config.json`、`app\runtime\electron-helper\main.js.prepromo.bak`、
  `promo-err.log` / `promo-out.log` / `promo-renderer.log`；安装时生成的 `Uninstall.exe` 由工具白名单认掉）→
  登记项 `DisplayVersion` 由 1.1.3 变成 **1.1.4**、`InstallLocation` 与 `InstallDir` 仍指向 `D:\...\BlueHairMaid` →
  按她原来的方式把桌宠重新拉起来（WMI 起 `electron\electron.exe "…\launcher"`，4 个 `electron.exe` 进程都在），
  `launcher\index.html` **95,329 B**，sha256 与 `stage\` 完全一致
  （`97A2C7F4A2D117F5CD73B9096AFFA4D71AB7369ECF37E7CD5C6EA3BFF6AB590B`）。
- **测试前快照 / 跑完还原**：`_accept\user-state-114b\`（两个 `HKCU` 键 + 桌面 4 个 `.lnk` + 开始菜单），
  两条真机路线跑完按快照还原桌面与开始菜单（主人的 4 个 `.lnk` 原样）；两个测试路线各自卸载时会把
  `HKCU\…\Uninstall\BlueHairMaid` 与 `HKCU\Software\BlueHairMaid` 删掉，所以**她那份的登记项是升级时由安装器重新写的**，
  特意**没有**再拿快照里那份 `DisplayVersion=1.1.3` 盖回去 —— 那样会把 1.1.4 的文件登记成 1.1.3；
  测试目录 `D:\_test114-install` / `D:\_test114-zip` 与 `_accept\Programs\BlueHairMaid114` 都在仓库外，不随版本发布。
- **版本号**：`_accept\bump-114.cjs` 显式 (from, to) 对、每对必须恰好命中 1 次，**14 个文件 60 处**（4 个 `package.json`、
  `build\installer.nsi`、`NOTICE.md`、两个 README、`docs\README.md`、`bug_report.md`、`differences-from-upstream.md`、
  `known-issues.md`、`code-signing.zh-CN.md`、`how-to-publish.zh-CN.md`）；成品真值由 `_accept\fill-114.py` 从
  `release\*.sha256` 读出来填进发布说明与两个 README（可重复跑），不手抄。主人当天否掉「录制模式」之后重打了一遍成品，
  数字用 `_accept\refill-114.py`（把上一轮的旧 bytes/sha 显式列成表逐个替换，残留就 `exit 1`）再刷一次，
  无版本号的别名 `release\cute-fat-fish-pet-setup.exe` 同步成新 exe 的副本 + 对应 `.sha256`。

### 1.2.0 的验收（2026-10-09）

- **功能验证（假 GitHub + 真控制台，CDP 驱动）**：`_accept\run-update-live.ps1` 全程编排 —— 先拍主人 HKCU 与快捷方式的快照
  （`_accept\state-112.ps1 -Mode snapshot -Out _accept\user-state-120b`），再静默把 1.2.0 装进 `D:\_e2e120\install` 当底座，
  用 `_accept\e2e-tools.cjs doctor` 把 `launcher\package.json` 改成 1.1.4 假装「旧版在跑」，起 `_accept\feed-120.cjs`
  这个假 GitHub（`/feed.json` 形状与 `releases/latest` 一致、只喂真安装包、`digest` 是真 sha256），最后用
  `_accept\test-update-live.cjs` 通过 CDP 点真按钮：
  - live 驱动 **21/21**：检查前角标「还没检查过」、按钮禁用 → 点「检查更新」→ `当前 1.1.4 → 新版 1.2.0`、
    `有新版 1.2.0（约 331.7 MB）`、按钮解锁 → 下载进度样本 `正在下载 48.7 MB / 331.7 MB（15%） · 120.8 MB/s`
    … `234.7 MB（71%） · 194.8 MB/s` → 交班文案「马上关掉窗口开始装 1.2.0」→ 更新日志
    `[20:57:13] 开始更新：1.1.4 -> 1.2.0` / `安装目录：D:\_e2e120\install` / `[20:57:14] 控制台已退出` /
    `开始静默安装：… /S /D=D:\_e2e120\install` / `[20:58:03] 安装程序退出码：0` / `控制台已重新打开` / `收工`；
    `updates\last-result.txt` = `ok=1 / exit=0 / from=1.1.4 / to=1.2.0 / at=2026-10-09T20:58:03`；
    `apply-update.ps1` 与 `apply-update.vbs` 都自删、347 MB 安装包删掉、安装目录里没留下便携脚本。
  - 更新后的树与 `stage\` 逐字节核（`build\verify-install.py`）**exit 0**：**712 个文件逐字节一致
    （797,896,795 B）**，实装 713 个（多出来的只有安装时生成的 `Uninstall.exe`）⇒ 一键更新装出来的树与发布树完全一样；
    登记项 `DisplayVersion=1.2.0`、`InstallDir` 指向更新后的目录。
  - 回读驱动 **4/4**：更新完第一次启动，角标 `当前 1.2.0 · 刚更新过`、终端
    `上次更新成功：已经升到 1.2.0 了（1.1.4 → 1.2.0）。`、`last-result.txt` 读完即删。整套 `failures: 0`，
    跑完卸载并按快照还原主人状态（`DisplayVersion=1.1.4`、`InstallLocation=D:\...\BlueHairMaid`、桌面 4 个 `.lnk`）。
- **三个测试脚手架的坑**（都不是产品问题，写下来免得再犯）：① 把「`launcher\package.json` 变成 1.2.0」当作安装完成信号是错的
  —— 安装器先铺小文件、最后才收尾，会读到半截树（`node\bin\node.exe` 0 字节、语音模型 sha 不符）并让测试在对方还在跑的
  时候就卸载 / 还原，收工时它又把登记项写回测试目录；现在等更新日志里出现「收工」（ps1 的最后一行）。② 读
  `last-result.txt` 要先去掉 UTF-8 BOM（PS 5.1 的 `-Encoding UTF8` 会写 BOM）；产品自己认 BOM，是断言写错了。
  ③ 安装器渠道的安装目录里本来就没有那 4 个便携脚本（那是绿色包渠道才有的），所以「日志里清掉旧脚本」的条数不能硬编成 4。
- **真机验收（安装器）**：`release\cute-fat-fish-pet-1.2.0-setup.exe` = **347,802,318 B**
  （`22DB908B29AB28E6C811FC8019E624240BAEC676E9A6D046D330EA39643CAFB4`，NSIS 全 LZMA）；`_accept\accept-exe-120.ps1`
  静默装进隔离目录 `_accept\Programs\BlueHairMaid120`（52 秒，**713 个文件 / 798,152,745 B** = 该装的 712 个 + 安装时生成的
  `Uninstall.exe`）→ `verify-install.py exit=0`（712 个逐字节一致，797,896,795 B）→ 登记项 `DisplayName=可爱大肥鱼桌宠` /
  `DisplayVersion=1.2.0` / `InstallLocation` 与 `InstallDir` 都指向该目录 → `Uninstall.exe /S`（2 秒）后安装目录消失、
  登记项清掉、`%APPDATA%\BlueHairMaid` **71 个文件 / 4,991,712 B 一字未动**。
- **真机验收（绿色包）**：`release\cute-fat-fish-pet-1.2.0-win-x64.zip` = **417,016,073 B**
  （`75EA491EBF46B2A4ADBDA1EE6589AC8ACEE17F1E397E0A928EC8D2110AA44502`，716 个文件）；解压 21 秒 → 716 个文件 /
  797,921,310 B → 树内 `node verify.mjs` **exit 0**（4 棵树的整树指纹 + **27 个关键文件**全对；`launcher` 从 9 个文件涨到
  10 个，新增的就是 `launcher\update.js` 27,340 B，`launcher\index.html` 102,900 B）→ `安装.cmd` 真装一次（2.8 秒，
  日志以 `[ok] Setup finished.` 结束）→ `verify-install.py`：712 个逐字节一致（797,896,795 B），`exit=1` 只因那 4 个便携
  脚本本来就该留在便携安装目录里（工具口径，同 1.1.4）→ 登记项 `DisplayVersion=1.2.0`、`UninstallString` 指向该目录的
  `卸载.cmd` → `卸载.cmd`（3.8 秒）后安装目录消失、登记项清掉、指向测试目录的桌面与开始菜单快捷方式清掉、
  `%APPDATA%\BlueHairMaid` 用户数据保留。
- **快照与还原**：`_accept\user-state-120b\`（两个 HKCU 键 + 桌面 4 个 `.lnk` + 开始菜单 + `registry.json`）。**注意**：测试
  安装器会把桌面与开始菜单里那个「可爱大肥鱼桌宠」快捷方式改写成指向测试目录，所以**拍完快照后要确认它们仍指向
  `D:\...\BlueHairMaid`** —— 本次就发现 `_accept\user-state-120\` 里的两份被上一轮测试污染了（指向已删掉的
  `D:\_e2e120\install`），已用 1.1.4 时的快照 `_accept\user-state-114b\` 里的原件修回，桌面与开始菜单现均指向
  `D:\...\BlueHairMaid`。测试目录 `D:\_test120-zip`、`D:\_test120-install`、`D:\_e2e120` 与
  `_accept\Programs\BlueHairMaid120` 都在仓库外，跑完已删，不随版本发布。
- **成品真值**：`_accept\fill-120.py`（幂等：台账 `_accept\fill-120-last.json` 存上一轮的 bytes/sha，重打后先把旧值逐个替换成
  新值，再填 `{{…}}` 占位符，残留占位符就 `exit 1`）本次刷新 **16 处**；无版本号的别名
  `release\cute-fat-fish-pet-setup.exe`（347,802,318 B / `22DB908B…`）与 `.sha256` 同步成同一份字节。
- **版本号**：四个 `package.json`、`build\installer.nsi` 的 `!define APP_VER` 默认值、`NOTICE.md`、两个 README、
  `docs\README.md`、`bug_report.md`、`differences-from-upstream.md`、`code-signing.zh-CN.md`、`how-to-publish.zh-CN.md`
  一起改到 1.2.0；`verify.mjs` 的关键文件表新增 `launcher\update.js`（26 → **27** 个）。
- **正式发布与主人那份**：`gh release create v1.2.0`（4 个成品 + 标题「可爱大肥鱼桌宠 1.2.0」+ `--notes-file docs\release-notes-1.2.0.md`）→
  <https://github.com/12we21/cute-fat-fish-pet/releases/tag/v1.2.0>；随后 `gh release upload v1.2.0 … -R 12we21/cute-fat-fish-pet --clobber`
  补传无版本号别名（`gh` 的 remote 主机判定抽风时，加显式 `-R` 就好），共 **6 个资产**：
  `cute-fat-fish-pet-1.2.0-setup.exe` 347,802,318 / `.sha256` 105 B / `cute-fat-fish-pet-1.2.0-win-x64.zip` 417,016,073 / `.sha256` 107 B /
  别名 `cute-fat-fish-pet-setup.exe` 347,802,318 / 别名 `.sha256` 93 B。`api.github.com/repos/12we21/cute-fat-fish-pet/releases/latest`
  返回 `tag_name=v1.2.0`，exe 的 `digest` = `sha256:22db908b…43cafb4`、zip = `sha256:75ea491e…aa44502`、别名与 exe 相同；
  永久链接 `curl.exe -sIL …/releases/latest/download/cute-fat-fish-pet-setup.exe` → 302 → 302 → **200 / Content-Length 347,802,318**。
- **主人那份原地升级**：`_accept\upgrade-her-120.ps1`（纯 ASCII；用 WMI 起 `setup.exe /S /D=<她的目录>`）—— **52 秒**，718 → **719 个文件**，
  其中 712 个与 `stage\` 逐字节一致（797,896,795 B）、`verify-install.py` 报的多出 6 个全是她自己的东西
  （`app\runtime\electron-helper\main-config.json`、`main.js.prepromo.bak`、`promo-err.log`、`promo-out.log`、
  `promo-renderer.log`、`standalone\online.json`）+ 安装时生成的 `Uninstall.exe`；**没有任何文件被删**，尺寸变化的只有
  `launcher\index.html`、`launcher\main.js`、`launcher\preload.js`、`verify.mjs`，新增 `launcher\update.js`；注册表
  `DisplayVersion=1.2.0`、`InstallLocation` 与 `InstallDir` 仍指 `D:\...\BlueHairMaid`；升完用 WMI 起
  `electron.exe "…\launcher"`，她的 4 个 `electron.exe` 全回来了（主窗口标题「蓝毛小女仆」），控制台里「检查更新 / 下载并更新」
  两个按钮都在。
