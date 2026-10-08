<div align="center">

# 可爱大肥鱼桌宠

**她叫「蓝毛小女仆」——一只住在你 Windows 桌面上的透明小桌宠。**

会自己待机、走动、做小动作；能陪你聊天、看一眼你的屏幕说两句；你让她动手，她还能打开软件 / 文件 / 文件夹 / 网页，或者替你起一段录屏。

![她的样子](docs/images/hero.png)

[安装](#安装) · [第一次运行](#第一次运行她自己会做这些事) · [数据与隐私](#数据与隐私) · [从源码构建](#从源码构建) · [许可与第三方](#许可与第三方)

</div>

---

## 这是一个独立作品

这是一个由 Mikolu 独立开发和维护的桌面宠物项目。

特别感谢原作者 PC2005-cloud 在 0.3.0 版本提供的早期基础架构与灵感。

- **对外产品名**：可爱大肥鱼桌宠
- **她本人**：蓝毛小女仆
- **作者 / 维护者**：Mikolu
- **本仓库**：1.1.0 起的**完整源码仓库**——`src\` 里就是成品源码，不再有「上游蓝本 + 补丁脚本」那一套；打包只是把源码树按发布结构铺开，再拼上不进 git 的外部运行时（见 [从源码构建](#从源码构建)）。

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

一句话：**改名字只改看得见的，看不见的一律不动**，这样从 1.0.0 升上来的用户什么都不用做。

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

下载 **`cute-fat-fish-pet-1.1.0-setup.exe`**（约 330 MB，NSIS 安装器）双击。

- 默认装到 `%LOCALAPPDATA%\BlueHairMaid`——**不需要管理员权限**。
- 想装到别处（D 盘 / 移动硬盘）就在「选择安装位置」那一步改；装完会建开始菜单项和桌面快捷方式。
- 包里自带 Electron 运行时、语音引擎与模型、语音识别要用的真 `node.exe`，装完就是**离线可用**的。

![安装界面](docs/images/installer.png)

### 方式二：绿色 zip 包

下载 **`cute-fat-fish-pet-1.1.0-win-x64.zip`**（约 400 MB，解压后约 760 MB），解压到任意目录，然后二选一：

- 双击 `安装.cmd`：建快捷方式、写卸载登记（想让它像装过一样）；
- 或者直接双击 `standalone\start-pet.vbs` 起桌宠、`standalone\stop-pet.vbs` 停（纯绿色，不写注册表）。

移动硬盘 / U 盘上跑就选后者；想让数据跟着程序走，在程序目录里放一个空的 `portable.txt`（见 [数据与隐私](#数据与隐私)）。

### 每个包都带 `.sha256`

`cute-fat-fish-pet-1.1.0-setup.exe.sha256`、`cute-fat-fish-pet-1.1.0-win-x64.zip.sha256`，格式是 `<SHA256>  <文件名>`，用来核对下载是否完整：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.0-setup.exe -Algorithm SHA256
```

> 发布用的文件名一律是 ASCII：GitHub Release 会把资产名里的非 ASCII 字符直接删掉
> （中文名上传后会变成 `-1.1.0-.exe`）。中文只留在产品名、快捷方式和「应用和功能」里。

### 装完怎么开、怎么关、怎么卸

- **开**：双击桌面「可爱大肥鱼桌宠」打开**控制台**，在控制台里点「启动桌宠」。
  注意：**控制台不会自动把她拉起来**——这是故意的，省得你只是想改个设置，她就先跳出来。
- **关**：控制台里点停止，或双击 `standalone\stop-pet.vbs`。
- **开机自启和自动更新目前没做**，需要的话自己把控制台快捷方式丢进「启动」文件夹。
- **卸载**：控制面板 / 设置里的「可爱大肥鱼桌宠」，或安装目录里的 `卸载.cmd`。
  卸载**不会**删你的数据（人设、记忆、聊天记录都留着），想彻底清干净就自己删数据目录（见下一节）。

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
├─ build\             打包：build.mjs（铺 stage）、toolchain.mjs（找外部件）、installer.nsi、mkexe.py、mkzip.py
├─ assets\            安装 / 卸载脚本与随包的说明文本（使用说明.txt、第三方声明.txt、LICENSE.txt）
├─ docs\              发布说明、发布流程、代码签名、图片
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

产物名由 `src\package.json` 的 `version` 生成（且只用 ASCII——GitHub Release 会删掉资产名里的非 ASCII 字符），所以这一版就是 `cute-fat-fish-pet-1.1.0-setup.exe` 和 `cute-fat-fish-pet-1.1.0-win-x64.zip`。

> 构建脚本口径以 `build\build.mjs` 头部注释和根 `package.json` 的 `scripts` 为准；`build\check-paths.mjs` 是构建期门禁，`--no-gate` 能跳过（不推荐）。

---

## 技术栈

- **桌面渲染**：Electron 43 透明无边框窗口，逐个宠物一个窗口；原生 JS + Canvas 播 VP9-alpha webm，用滤色叠在壁纸上；窗口跟着宠物包围盒走，默认整窗点击穿透，光标进身体才翻转可交互。
- **宿主半侧**：`src\lib\index.js` 一份代码两种活法——在 DSH 里当 Cordis 插件（`name/inject/apply`），在独立版里由 `standalone\main.mjs` 用运行期 `registerHooks` 把三个 `@deepseek-ai/*` 包指到 `standalone\shims\`，再喂一个「刚刚够用」的伪 ctx（`standalone\context.mjs`），然后照常调用同一个 `apply(ctx)`。
- **控制台**：单个 HTML（`launcher\index.html`）+ Electron 壳，IPC 到 `pet-api.js`；启停走 `standalone\main.mjs` / `stop-pet.mjs`。
- **模型**：本机 Ollama，或任何 OpenAI 兼容接口（`/chat/completions`、视觉走 `image_url`）；余额查询走 DeepSeek 官方 `/user/balance`。
- **语音**：sherpa-onnx + SenseVoice int8 + silero VAD（离线识别）；Edge TTS + SSML（在线合成）。
- **桌面渲染端与控制台的通道**：本机回环上的控制桥（1.1.0 起带 token 鉴权 + CORS 白名单，见 [发布说明](docs/发布说明-1.1.0.md)）。
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
