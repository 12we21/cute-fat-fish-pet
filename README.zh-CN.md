<div align="center">

# 蓝毛小女仆

**一只免费、开源的 Windows 桌面小桌宠——透明、会自己动、能陪你聊天。**

会自己待机、走动、做小动作；能陪你聊天、看一眼你的屏幕说两句；你让她动手，她还能打开软件 / 文件 / 文件夹 / 网页，或者替你起一段录屏。

![她的样子](docs/images/hero.png)

[安装](#安装) · [第一次运行](#第一次运行她自己会做这些事) · [数据与隐私](#数据与隐私) · [从源码构建](#从源码构建) · [核对下载](#核对下载) · [许可与第三方](#许可与第三方)

[English](README.md) · **中文文档**

</div>

---

## 这是一个独立作品

这是一个由 Mikolu 独立开发和维护的桌面宠物项目 —— **蓝毛小女仆**（Blue-Haired Little Maid）。

特别感谢原作者 PC2005-cloud 在 0.3.0 版本提供的早期基础架构与灵感。

- **产品名**：**蓝毛小女仆**（Blue-Haired Little Maid）
- **仓库 / 包 / 安装器名**：`cute-fat-fish-pet` —— 旧显示名「可爱大肥鱼桌宠」
- **作者 / 维护者**：Mikolu
- **本仓库**：1.1.0 起的**完整源码仓库**——`src\` 里就是成品源码，不再有「上游蓝本 + 补丁脚本」那一套；打包只是把源码树按发布结构铺开，再拼上不进 git 的外部运行时（见 [从源码构建](#从源码构建)）。

> **关于名字**：蓝毛小女仆 是产品名。仓库名、npm 包名和已经发出去的安装器仍沿用旧名 **`cute-fat-fish-pet` / 「可爱大肥鱼桌宠」** —— 改这些会让已装的用户、桌面快捷方式和下载链接全部断掉，所以保持原样。在下一次重新打包之前，Windows 的桌面快捷方式和「设置 → 应用」里显示的仍是「可爱大肥鱼桌宠」。

上游发布的 `dsh-pet@0.3.0` 安装包里共有 243 个文件，其中 **232 个与本仓库逐字节相同，11 个是刻意改过的**（每个都带大小与原因，见 [docs/differences-from-upstream.md](docs/differences-from-upstream.md)），**没有删掉上游任何文件**；另外有 2 个引擎文件是本项目自己加的（`runtime/electron-helper/obs-ctl.js`、`stt-worker.mjs`）。其余部分（控制台、独立运行器、构建链、安装器、文档）都是本项目自己的东西。

### 关于内部标识：故意保留 `dsh-pet` / `BlueHairMaid`

对外的东西换了名字，**里面这些标识一个都没改**，而且是故意不改：

| 内部标识 | 值 | 改了会怎样 |
| --- | --- | --- |
| 应用目录 / APP_ID / 卸载登记 | `BlueHairMaid` | 老用户的配置、数据、快捷方式、卸载记录全部对不上，等于重装一只新的 |
| 桌宠插件包名 | `dsh-pet` | 数据根、插件装载路径改变，人设与记忆「搬家」 |
| 桌面渲染端包名 | `dsh-pet-electron-helper` | 桌宠页面的 localStorage（位置、大小、立绘状态）读不到，她会被摆回屏幕中央 |
| 浏览器存储键 | `dsh-pet-*` | 同上，老配置全部失效 |
| 本机路由前缀 | `/dsh-pet-7340` | 与已发布版本不兼容，控制台与桌宠对不上话 |
| 用户数据目录 | `%APPDATA%\BlueHairMaid` | 老用户的人设 / 记忆 / 屏幕状态丢失 |

一句话：**改名字只改看得见的，看不见的一律不动**，这样从 1.0.0 升上来的用户什么都不用做。同一份说明也在 [NOTICE.md](NOTICE.md) 第 5 节。

---

## 功能

![控制台](docs/images/console.png)

- **自己会动**：106 个手绘透明动画（VP9-alpha webm，滤色叠在壁纸上），待机呼吸、左顾右盼、随机走动、随机小动作；动作权重、出现频率可调。
- **陪聊**：点她说话，气泡 + 聊天窗；本机模型（Ollama）或联网模型（OpenAI 兼容接口）都行，控制台里三档切换——**本机 / 自动择优 / 联网**。
- **看屏幕**（可关）：定时截一张图交给视觉模型，她点评两句；没配视觉模型时这条路直接不启用，而不是随便找张图糊弄。
- **碎碎念与主动说话**：她在没事的时候会自己冒泡，也能被工作状态驱动（任务开始 / 结束 / 出错）。
- **能动手（你说了算）**：打开软件 / 文件 / 文件夹 / 网页；录屏交给 OBS 或你指定的软件，存到你指定的位置。三个权限开关随时关掉，关掉她就真的不动。
- **语音**：语音输入走包内的 sherpa-onnx + SenseVoice int8（离线，不需要联网）；说话用 Edge TTS + SSML，语速 / 音高能调，音高存在数据根里。
- **单 HTML 控制台**：开 / 关 / 看状态、模型与 AI 大脑、语音、权限、录屏、日志，都在一个窗口里，不用命令行。
- **人设与记忆**：人设文件、聊天记录、屏幕监测状态都在数据根里，可以自己改、可以整份备份。

![右键菜单](docs/images/menu.png)

---

## 安装

### 方式一：安装程序（推荐）

下载 **`cute-fat-fish-pet-1.2.1-setup.exe`**（约 331.7 MB，NSIS 安装器）双击。

> **永远指向最新版的链接**：每一版都会额外放一份去掉版本号、内容完全相同的副本，
> 所以下面这条链接永远是最新安装包：
> <https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe>

- 默认装到 `%LOCALAPPDATA%\BlueHairMaid`——**不需要管理员权限**。
- 想装到别处（D 盘 / 移动硬盘）就在「选择安装位置」那一步改；装完会建开始菜单项和桌面快捷方式。
- 包里自带 Electron 运行时、语音引擎与模型、语音识别要用的真 `node.exe`，装完就是**离线可用**的。

![安装界面](docs/images/installer.png)

### 方式二：绿色 zip 包

下载 **`cute-fat-fish-pet-1.2.1-win-x64.zip`**（约 397.7 MB，解压后约 760 MB），解压到任意目录，然后二选一：

> **1.1.1 把这条绿色包的路整条修好了。** 一定要**先解压**（右键 →「全部解压缩…」），再到解压出来的目录里双击
> `安装.cmd`：它会先检查包是否完整，缺件时用中文说明（旧版是一闪而过、什么都不说）；
> 装出来的名字是「可爱大肥鱼桌宠」、版本号是真的；`卸载.cmd` 也会真的把整个目录删干净，而不是留下 714 个文件。
> 细节见 [1.2.1 发布说明](docs/release-notes-1.2.1.md) 与 [已确认缺陷](docs/known-issues.md)。

- 双击 `安装.cmd`：建快捷方式、写卸载登记（想让它像装过一样）；
- 或者直接双击 `standalone\start-pet.vbs` 起桌宠、`standalone\stop-pet.vbs` 停（纯绿色，不写注册表）。

移动硬盘 / U 盘上跑就选后者；想让数据跟着程序走，在程序目录里放一个空的 `portable.txt`（见 [数据与隐私](#数据与隐私)）。

### 每个包都带 `.sha256`

`cute-fat-fish-pet-1.2.1-setup.exe.sha256`、`cute-fat-fish-pet-1.2.1-win-x64.zip.sha256`，格式是 `<SHA256>  <文件名>`，用来核对下载是否完整：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.1-setup.exe -Algorithm SHA256
```

> 发布用的文件名一律是 ASCII：GitHub Release 会把资产名里的非 ASCII 字符直接删掉
> （中文名上传后会变成 `-1.1.0-.exe`）。中文只留在产品名、快捷方式和「应用和功能」里。

### 装完怎么开、怎么关、怎么卸

- **开**：双击桌面「可爱大肥鱼桌宠」打开**控制台**，在控制台里点「启动桌宠」。
  注意：**控制台不会自动把她拉起来**——这是故意的，省得你只是想改个设置，她就先跳出来。
- **关**：控制台里点停止，或双击 `standalone\stop-pet.vbs`。
- **开机自启目前没做**，需要的话自己把控制台快捷方式丢进「启动」文件夹。**更新不用手动下了**：控制台里
  「更新」→「检查更新」→「下载并更新」会自己下载、核对哈希、关掉自己装好再开回来（见 [怎么升级](#以后怎么升级)）。
- **卸载**：控制面板 / 设置里的「可爱大肥鱼桌宠」，或安装目录里的 `卸载.cmd`。
  卸载**不会**删你的数据（人设、记忆、聊天记录都留着），想彻底清干净就自己删数据目录（见下一节）。

### 以后怎么升级

**从 1.2.0 起，一键就行**：打开控制台 →「更新」→「检查更新」，看到新版再点「下载并更新」。
（1.1.4 及更早没有这个按钮，按下面第 2 条手动升一次就有了。）
它会自己把安装包下到数据目录的 `updates\`、一边下一边核对 SHA-256，然后**关掉自己**、静默装回同一个目录，
最后把桌宠（本来在跑的话）和控制台自己开回来；装完顺手删掉那 347 MB 的安装包，结果下次启动会如实报给你。
发布里没给哈希、或者哈希对不上，它宁可不装；从源码目录跑（git clone）也不会走这条路，自己 `git pull`。

**手动（更早的版本，或者控制台连不上 GitHub 时）：**

1. **先把她关掉**：托盘图标右键 → 退出，或双击 `standalone\stop-pet.vbs`。
   安装器故意不杀进程（免得误杀同一台电脑上**另外一只**桌宠），她还在跑的时候它会停下来，让你先关掉再继续。
2. **下载新安装包**：上面那条「永远指向最新版」的链接，或到 [Releases 页面](https://github.com/12we21/cute-fat-fish-pet/releases) 拿最新一版。
3. **双击安装、一路「下一步」**：安装器会从 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid` 读出上一版装在哪个目录，**装回同一个目录**，不会多出一份 761 MB 的副本；桌面与开始菜单快捷方式会重建。
4. **从控制台重新启动她**。

什么会留下：人设、记忆、聊天记录、设置与模型配置都在数据目录 `%APPDATA%\BlueHairMaid` 里，安装器（和上面那个一键更新）一个字节都不碰。

绿色 zip 用户：一键更新同样能用，但那 4 个便携脚本（`安装.cmd`/`卸载.cmd`/`install.ps1`/`uninstall.ps1`）更新后会被删掉，卸载改由新登记的卸载项负责；也可以照旧把新 zip 解压覆盖旧目录，自己加的 `standalone\online.json`（联网模型设置）和 `portable.txt` 留着。

> 脚本安装：`cute-fat-fish-pet-setup.exe /S /D=D:\要装的目录`。两点注意——静默模式**不会**自动认旧目录，`/D=` 得自己给（控制台的一键更新会先写 `HKCU\Software\BlueHairMaid\InstallDir`，所以它认得）；她还在跑的时候它同样不会替换文件。

---

## 第一次运行，她自己会做这些事

你什么都不用配，第一次启动她会在本机做一次「自动适配」：

1. **看看你的显卡**：读注册表里的显存大小，决定给模型多少上下文、什么时候把它请出显存（结果写在 `device-profile.json`）。
2. **找本机模型**：列出 Ollama 里已经拉下来的模型，挑一个当「聊天模型」，有视觉模型就再挑一个当「看屏幕」用的。
3. **铺默认人设**：把随包的默认人设 / 动画配置 / 屏幕监测配置拷进数据根——**只补缺的，绝不覆盖你已经改过的**。
4. **写运行记录**：`runtime.json`（pid / 端口 / 模型 / 启动时间），退出时删掉；桌宠没起来时靠它排查。

一个模型都没有也能跑：她会动、会待机、会做小动作，只是不开口。想让她说话，装个 [Ollama](https://ollama.com/) 拉一个模型，或者在控制台「模型 · AI 大脑 → 联网模型」里填一个 OpenAI 兼容接口（地址 + Key + 模型名）。

---

## 数据与隐私

### 数据放哪

程序目录（`%LOCALAPPDATA%\BlueHairMaid`）**当成只读**；所有会变的东西都在「用户数据目录」，按下面四级优先级决定：

1. 环境变量 `DSH_PET_DATA_DIR`（测试 / 高级用法）
2. 程序目录里的 `data-root.txt`（里面写一行路径）
3. 程序目录里的 `portable.txt` → 数据放 `<程序目录>\userdata\`（便携模式）
4. **默认** `%APPDATA%\BlueHairMaid\`

```
%APPDATA%\BlueHairMaid\
├─ dsh-pet\
│  ├─ main-config.json          人设 + 宠物列表
│  ├─ screen-watch\state.json   看屏幕的配置与状态、大脑档位、本机模型
│  ├─ record.json               录屏设置（录哪个软件、存哪）
│  ├─ tts-pitch.txt             音高（默认 +0Hz）
│  └─ main-animation\           你自己的动画素材（有就优先用）
├─ device-profile.json          第一次运行自动适配的结果
├─ runtime.json                 运行记录（pid / 端口 / 模型），退出时删
├─ console\                     控制台自己的窗口状态
└─ logs\
   ├─ runner.log / runner.err.log    宿主那半的日志
   └─ pet-control.log                控制台的启停记录
```

桌宠页面自己的 localStorage（位置、大小、立绘状态）在 `%APPDATA%\dsh-pet-electron-helper`——这是 Electron 的规矩，所以上面那份「内部标识故意不改」的说明里也包括它。

### 隐私

- **看屏幕**是**本机截图 → 交给你自己选的那个模型**。选本机 Ollama 就完全不出机器；选联网模型才会把图发到你填的那个接口去。不想用就在控制台关掉，关掉就不截。
- **语音识别离线跑**：sherpa-onnx + SenseVoice int8 模型在包里，不联网。
- **Edge TTS 要联网**（用的是微软的在线语音合成）。
- **联网模型的 API Key 是明文**存在 `standalone\online.json`（程序目录里，跟 1.0.0 一样）。它是本机文件、只给你自己看，但别把这台机器的这个文件发给别人，也别把带 Key 的目录整个打包上传。
- **她不会自己往外发东西**：没有遥测、没有「回家」的统计上报；只有你打开的联网功能（联网模型、Edge TTS）会走网络。
- 卸载不删数据；`online.json` 这类带 Key 的文件请自己清理。

更细的说明（含 1.1.0 对控制口的加固）在 [SECURITY.md](SECURITY.md)。

---

## 目录结构

### 源码仓库（本仓库）

```
.
├─ src\              成品源码：桌宠本体（宿主半侧 + 浏览器半侧）、桌宠页面、随包的 node_modules
│  ├─ lib\           index.js（宿主半侧，Cordis 插件：name/inject/apply）、client.js（浏览器半侧）
│  ├─ src\           TypeScript 源码（host / client / shared），lib\ 是它的构建产物
│  ├─ assets\        动画 webm、表情包、图片、字体、config.jsonc
│  └─ runtime\electron-helper\   桌面渲染端（Electron 透明窗口 + 自己的 renderer）
├─ launcher\          控制台：单 HTML + Electron 壳（main.js / pet-api.js / rec.js / paths.js）
├─ standalone\        独立模式运行器：伪 ctx（context.mjs）+ 真 http 服务（server.mjs）
│  └─ shims\          三个 DSH 包替身（home-paths / credentials / llm）
├─ defaults\          第一次运行铺进数据根的默认文件
├─ build\             打包：build.mjs（铺 stage）、toolchain.mjs（找外部件）、check-paths.mjs（隐私门禁）、
│                     installer.nsi、mkexe.py、mkzip.py
├─ assets\            安装 / 卸载脚本与随包的说明文本（使用说明.txt、第三方声明.txt、LICENSE.txt）
├─ docs\              发布说明、开发日志、与上游差异、路线图、发布流程、代码签名、图片
├─ verify.mjs         发布版自校验（整树指纹 + 隐私文件检查）
└─ package.json       构建入口（npm run build / exe / zip / verify / paths）
```

### 安装之后

```
<安装目录>\
├─ app\               ← src\ 铺到这里（桌宠本体）
├─ electron\          Electron 43 运行时（不进 git）
├─ node\              语音识别用的真 node.exe（不进 git）
├─ speech\            sherpa-onnx 引擎 + SenseVoice int8 模型（不进 git）
├─ launcher\          控制台
├─ standalone\        独立模式运行器 + 两个 .vbs
├─ defaults\          默认配置
├─ assets\            使用说明.txt、第三方声明.txt、LICENSE.txt、安装/卸载脚本
├─ 卸载.cmd
└─ verify.mjs         自校验
```

---

## 从源码构建

**需要**：Windows x64、Node.js 24（自带 `node --experimental-strip-types` 之类新特性）、Python 3（打包脚本）、[NSIS 3](https://nsis.sourceforge.io/)（出安装程序）。

**三块外部运行时约 689 MB，不进 git**，必须自备一份：

| 块 | 是什么 | 大小 |
| --- | --- | --- |
| `electron\` | Electron 43.3.0 win-x64 | 约 347 MB |
| `node\` | node v24.21.0 win-x64（语音识别的原生插件在 Electron 里加载不了：`External buffers are not allowed`，必须用真 node.exe） | 约 89 MB |
| `speech\` | sherpa-onnx 原生引擎 + SenseVoice int8 模型 | 约 253 MB |

最省事的办法是指向**一份已经装好的可爱大肥鱼桌宠**，它会直接从那儿认这三块：

```powershell
npm run toolchain                                   # 先看缺什么、去哪儿拿
node build\build.mjs --toolchain <一份已装好的可爱大肥鱼桌宠目录>   # 按发布结构铺进 stage\
npm run exe                                         # python build\mkexe.py  → release\cute-fat-fish-pet-<版本>-setup.exe
npm run zip                                         # python build\mkzip.py  → release\cute-fat-fish-pet-<版本>-win-x64.zip
npm run verify                                      # 核对 stage\ 的整树指纹（应全 OK）
npm run paths                                       # 构建期隐私路径门禁：本机绝对路径 / 私人目录不得进包
```

改完代码最常用的两条：

```powershell
node build\build.mjs launcher assets   # 只铺这几块（块名：app launcher standalone defaults assets verify electron node speech）
node build\build.mjs --list            # 只看会做什么，不动磁盘
```

产物名由 `src\package.json` 的 `version` 生成（且只用 ASCII——GitHub Release 会删掉资产名里的非 ASCII 字符），所以这一版就是 `cute-fat-fish-pet-1.2.1-setup.exe` 和 `cute-fat-fish-pet-1.2.1-win-x64.zip`。

> 构建脚本口径以 `build\build.mjs` 头部注释和根 `package.json` 的 `scripts` 为准；`build\check-paths.mjs` 是构建期门禁，`--no-gate` 能跳过（不推荐）。

---

## 核对下载

1.2.1 的两个成品：

| 文件 | 字节数 | SHA-256 |
| --- | --- | --- |
| `cute-fat-fish-pet-1.2.1-setup.exe` | 347864787 | `5D354375D41AD7CC6F8C1B5C87375664384E173B9AEE9520F0CEBDDDED516EC2` |
| `cute-fat-fish-pet-1.2.1-win-x64.zip` | 417022629 | `8C36D3B89C72EC5F968473BCB48AA28C6A93FA0E311261E863D264D2025B2843` |

1.2.0 与 1.1.4 的两个成品（留档）：

| 文件 | 字节数 | SHA-256 |
| --- | --- | --- |
| `cute-fat-fish-pet-1.2.0-setup.exe` | 347802318 | `22DB908B29AB28E6C811FC8019E624240BAEC676E9A6D046D330EA39643CAFB4` |
| `cute-fat-fish-pet-1.2.0-win-x64.zip` | 417016073 | `75EA491EBF46B2A4ADBDA1EE6589AC8ACEE17F1E397E0A928EC8D2110AA44502` |
| `cute-fat-fish-pet-1.1.4-setup.exe` | 347880285 | `495F5D3506C419B7967513E3F8C73F655F108FAC965BFF58B643EE018553C5D0` |
| `cute-fat-fish-pet-1.1.4-win-x64.zip` | 417002153 | `54F6832CCC6D609FC26497F12B54EE9DA4016E8ACA2F144246AC0F23CC9542FC` |

每个成品旁边都有同名 `.sha256`，发布说明里也有一份。

装完之后，包里的 `verify.mjs` 会再自查一遍（整个 `app\` 树的指纹、自己的文件、以及**不该存在**的文件）：

```powershell
node verify.mjs
```

构建侧还有反向的证明：`build\check-release.mjs` 保证 `stage\` 与仓库逐字节一致。

---

## 文档

| 文档 | 里面有什么 |
| --- | --- |
| [docs/development-log.md](docs/development-log.md) | 开发日志：每一步的动机 → 改动 → 验证 → 提交 |
| [docs/differences-from-upstream.md](docs/differences-from-upstream.md) | 与上游 dsh-pet 0.3.0 的逐文件差异（含大小与 SHA-256） |
| [docs/release-notes-1.2.1.md](docs/release-notes-1.2.1.md) | 1.2.1 发布说明 —— 连接测试有了明确反馈、界面照顾真人操作、问「在线还是离线」由代码如实回答 |
| [docs/release-notes-1.2.0.md](docs/release-notes-1.2.0.md) | 1.2.0 发布说明 —— 控制台里一键检查更新、下载并装好 |
| [docs/release-notes-1.1.4.md](docs/release-notes-1.1.4.md) | 1.1.4 发布说明 —— 录制时控制台不会露出 API Key |
| [docs/release-notes-1.1.3.md](docs/release-notes-1.1.3.md) | 1.1.3 发布说明 —— 说「打开 X」就能开网页、文件夹或文件（语音与打字都行） |
| [docs/release-notes-1.1.2.md](docs/release-notes-1.1.2.md) | 1.1.2 发布说明 —— 联网模型不再把思考过程念出来 |
| [docs/release-notes-1.1.1.md](docs/release-notes-1.1.1.md) | 1.1.1 发布说明 —— 绿色包双击即装、卸载不留残骸 |
| [docs/release-notes-1.1.0.md](docs/release-notes-1.1.0.md) | 1.1.0 发布说明（首次公开发布） |
| [docs/architecture-roadmap.zh-CN.md](docs/architecture-roadmap.zh-CN.md) | 架构路线图：去宿主化、控制桥安全、长期计划 |
| [docs/how-to-publish.zh-CN.md](docs/how-to-publish.zh-CN.md) | 发布流程 |
| [docs/code-signing.zh-CN.md](docs/code-signing.zh-CN.md) | 代码签名：选项、成本、要做什么 |
| [docs/history/](docs/history) | 更早的发布说明（存档） |
| [SECURITY.md](SECURITY.md) | 威胁模型与本机端口的加固 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 怎么构建、怎么测、怎么提改动 |
| [NOTICE.md](NOTICE.md) | 版权、署名与第三方组件 |

---

## 技术栈

- **桌面渲染**：Electron 43 透明无边框窗口，逐个宠物一个窗口；原生 JS + Canvas 播 VP9-alpha webm，用滤色叠在壁纸上；窗口跟着宠物包围盒走，默认整窗点击穿透，光标进身体才翻转可交互。
- **宿主半侧**：`src\lib\index.js` 一份代码两种活法——在 DSH 里当 Cordis 插件（`name/inject/apply`），在独立版里由 `standalone\main.mjs` 用运行期 `registerHooks` 把三个 `@deepseek-ai/*` 包指到 `standalone\shims\`，再喂一个「刚刚够用」的伪 ctx（`standalone\context.mjs`），然后照常调用同一个 `apply(ctx)`。
- **控制台**：单个 HTML（`launcher\index.html`）+ Electron 壳，IPC 到 `pet-api.js`；启停走 `standalone\main.mjs` / `stop-pet.mjs`。
- **模型**：本机 Ollama，或任何 OpenAI 兼容接口（`/chat/completions`、视觉走 `image_url`）；余额查询走 DeepSeek 官方 `/user/balance`。
- **语音**：sherpa-onnx + SenseVoice int8 + silero VAD（离线识别）；Edge TTS + SSML（在线合成）。
- **桌面渲染端与控制台的通道**：本机回环上的控制桥（1.1.0 起带 token 鉴权 + CORS 白名单，见 [发布说明](docs/release-notes-1.1.0.md) 与 [SECURITY.md](SECURITY.md)）。
- **打包**：Node + Python 脚本铺 `stage\`，NSIS 3 出安装程序、zip 出绿色包。

---

## 许可与第三方

- 本项目以 **MIT** 协议发布，见 [`LICENSE`](LICENSE)——里面有两段版权：上游原作者 PC2005-cloud，本整合发布版 Mikolu。
- **上游 MIT 全文原样随包分发**：[`assets/LICENSE.txt`](assets/LICENSE.txt)，没有删改，也没有移除原作者署名。
- 第三方组件（Electron / Chromium、Node.js、sherpa-onnx、SenseVoice 模型、silero VAD、npm 依赖、Edge TTS、联网大模型接口等）的许可证与出处逐条列在 [`assets/第三方声明.txt`](assets/第三方声明.txt)；Ollama 不随包分发，需要你自己装。
- 更细的说明：[`NOTICE.md`](NOTICE.md)。

---

## 联系方式

她是我自己写着玩的，有问题、建议、或者想要的功能，提到**本仓库的 Issues** 就行。

如果她让你的桌面变得有点可爱，那就够了。
