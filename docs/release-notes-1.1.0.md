# Release notes — Cute Fat Fish Pet 1.1.0

**First public release.** 2026-10-08 · Windows x64 · MIT

[中文说明见下方](#中文说明)

---

## What this is

Cute Fat Fish Pet is a desktop pet for Windows: a transparent little maid who lives on your desktop, chats with you (local Ollama or any OpenAI-compatible model), can look at your screen and comment on it, and — when you allow it — can open apps, files, folders and web pages for you or start a screen recording.

This is the **first public release** of the project, and the first one published from its own source repository.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.0-setup.exe`](../../releases/download/v1.1.0/cute-fat-fish-pet-1.1.0-setup.exe) | 347902120 B (331.8 MB) | `6C87705E890D020E95D23040A65F1DA6EB6224DDF4FB156AA1816D295F12C882` |
| [`cute-fat-fish-pet-1.1.0-win-x64.zip`](../../releases/download/v1.1.0/cute-fat-fish-pet-1.1.0-win-x64.zip) | 416989171 B (397.7 MB) | `7915809C79C9AE7F58FE7DB766BC68C399F8224CB9F024F05AE3CDE45D5075A9` |

Each asset ships with a `.sha256` file in the format `<SHA256>  <filename>`:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.0-setup.exe -Algorithm SHA256
```

- **Installer**: double-click, no administrator rights needed, installs to `%LOCALAPPDATA%\BlueHairMaid` (the location can be changed on the "Choose install location" page). Upgrades detect an existing installation and reuse its directory instead of installing a second 761 MB copy.
- **Portable zip**: unpack anywhere (~761 MB unpacked), then either double-click `安装.cmd` (creates shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (writes nothing to the registry).
- Both packages are **self-contained and offline-ready**: Electron runtime, the speech engine and the SenseVoice int8 model, and the real `node.exe` used for speech recognition are all inside.

**Requirements**: Windows 10/11 x64, about 761 MB of disk space. A GPU is optional: on first start she reads your VRAM, looks for models already present in Ollama and configures herself accordingly. Without any model she still idles and moves, she just does not talk.

**Start / stop**: the desktop shortcut opens the **console**; press **启动桌宠** to bring her up. The console deliberately does not start her automatically. Autostart and auto-update are not implemented yet.

## What is in this release

### The project is now a standalone source repository

- The repository contains the **actual shipped source** in `src/` — there is no "upstream blueprint + patch scripts" step any more. `overlay/` and the patch tooling are gone; a fresh clone builds the released layout directly.
- The build chain was rewritten for that: `build/build.mjs` lays the repository out into `stage/` (`app`, `launcher`, `standalone`, `defaults`, `assets`, `verify`, `electron`, `node`, `speech`), and `build/toolchain.mjs` locates the three external runtime pieces (Electron 43.3.0, node v24.21.0, sherpa-onnx + SenseVoice) either from a previously installed copy or from explicit flags.
- `build/check-release.mjs` proves that `stage/` matches the repository byte for byte, and `verify.mjs` self-checks the installed package (tree fingerprints plus a list of files that must never be shipped).

### Local control bridge hardened

The console talks to the pet over a loopback HTTP bridge. Both ends were tightened:

- The desktop-side control server now requires a **token** — `Authorization: Bearer <token>` or `X-Pet-Token` — generated per installation into `helper-control.json` with mode `0600`, compared in constant time. Write requests without it are rejected with `401` and nothing is written to the page.
- `Access-Control-Allow-Origin: *` is gone. Origins are checked against an allow-list (`127.0.0.1`, `localhost`, `::1` over http/https, plus requests with no `Origin`); unknown origins get `403` and no CORS headers. Responses echo the requesting origin and carry `Vary: Origin`.
- `OPTIONS` is answered as a preflight only; `/health` stays unauthenticated but only reports `ok` + a window count. Key names containing `__proto__` are rejected.
- If the token file cannot be written, the bridge **fails closed**: every write request is refused.
- The standalone runner's HTTP server got the same treatment: origin allow-list, and `/shutdown` now requires **POST + token** instead of accepting a bare `GET` (which any web page could previously trigger with a single `<img>` tag).

Because both ends changed together, the console and the pet must both be from 1.1.0 — after upgrading, if the console reports "the control bridge wants a key", restart the pet once so it writes its token.

### Privacy: no local paths in the package

- Hard-coded absolute paths to the author's machine were removed from the runtime. The speech worker now derives `node.exe` from the installation layout (`electron/electron.exe` and `node/bin/node.exe` are siblings), and remaining references use `%USERPROFILE%`-style placeholders.
- A build-time gate, `build/check-paths.mjs` (`npm run paths`), scans the repository and the staged package for local absolute paths and private directories; `build/build.mjs` runs it before laying out `stage/`.
- The test suite no longer contains a real user name; synthetic paths use a placeholder.

### Documentation

- `README.md` (English) and `README.zh-CN.md` (Chinese), plus [NOTICE.md](../../NOTICE.md), [SECURITY.md](../../SECURITY.md), [CONTRIBUTING.md](../../CONTRIBUTING.md) and issue templates.
- [docs/development-log.md](../development-log.md) — what changed, why, how it was verified, and in which commit.
- [docs/differences-from-upstream.md](../differences-from-upstream.md) — every file that differs from upstream dsh-pet 0.3.0, with sizes and SHA-256.
- [docs/architecture-roadmap.zh-CN.md](../architecture-roadmap.zh-CN.md) — roadmap for host-coupling removal and the remaining security work (Chinese).

## Compatibility

Upgrading keeps everything: the internal identifiers (`BlueHairMaid` app folder, `dsh-pet` plugin package, `dsh-pet-electron-helper` renderer, `dsh-pet-*` storage keys, `/dsh-pet-7340` route prefix and the `%APPDATA%\BlueHairMaid` data root) are deliberately unchanged, so your persona, memory, chat history, position and settings are picked up as they are. Uninstalling still does not delete your data.

## Known limitations

- **The binaries are not code-signed.** Windows SmartScreen may warn on first run ("More info" → "Run anyway"). What signing would involve is described in [docs/code-signing.zh-CN.md](../code-signing.zh-CN.md) (Chinese).
- No autostart, no auto-update, no installer-less update path yet.
- Files and text **inside** the package are still Chinese (`安装.cmd`, `卸载.cmd`, `assets\使用说明.txt`, …). Renaming them changes the package layout, so it is planned for a later release rather than mixed into this one.
- `src/lib/` is the compiled output of the TypeScript sources in `src/src/`; editing the TypeScript requires rebuilding `lib/` with the upstream toolchain.
- GitHub reports the license as `NOASSERTION`: `LICENSE` is MIT but carries two copyright lines (upstream author + this project), which the license detector does not recognize as a standard MIT file.

## License and attribution

MIT — see [LICENSE](../../LICENSE). The upstream MIT text ships unmodified as [`assets/LICENSE.txt`](../../assets/LICENSE.txt), with the original author's attribution intact; third-party components are listed in [`assets/第三方声明.txt`](../../assets/第三方声明.txt) and [NOTICE.md](../../NOTICE.md).

The pet engine started from **dsh-pet 0.3.0** by **PC2005-cloud**: of the 243 files in the published upstream package, 232 are byte-identical here and 11 were modified on purpose (each one listed in [differences-from-upstream.md](differences-from-upstream.md)); no upstream file was dropped. Everything else in this repository is this project's own work.

---

## 中文说明

### 这是什么

可爱大肥鱼桌宠（她叫「蓝毛小女仆」）是一只住在 Windows 桌面上的透明小桌宠：陪你聊天（本机 Ollama 或任何 OpenAI 兼容接口）、能看一眼你的屏幕说两句；你允许的话，她还能替你打开软件 / 文件 / 文件夹 / 网页，或者起一段录屏。

这是本项目的**首次公开发布**，也是第一次从它自己的源码仓库发布。

### 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `cute-fat-fish-pet-1.1.0-setup.exe` | 347902120 B（331.8 MB） | `6C87705E890D020E95D23040A65F1DA6EB6224DDF4FB156AA1816D295F12C882` |
| `cute-fat-fish-pet-1.1.0-win-x64.zip` | 416989171 B（397.7 MB） | `7915809C79C9AE7F58FE7DB766BC68C399F8224CB9F024F05AE3CDE45D5075A9` |

每个成品旁边都有同名 `.sha256`（格式 `<SHA256>  <文件名>`）：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.0-setup.exe -Algorithm SHA256
```

- **安装程序**：双击即可，不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`（在「选择安装位置」那一步可以改）。升级时会认出已经装过的那一份，直接装回原目录，不会再装一份 761 MB 的副本。
- **绿色 zip**：解压到任意目录（解压后约 761 MB），然后二选一：双击 `安装.cmd`（建快捷方式 + 写卸载登记），或直接运行 `standalone\start-pet.vbs`（不写注册表）。
- 两个包都是**自带运行时、离线可用**的：Electron、语音引擎与 SenseVoice int8 模型、语音识别要用的真 `node.exe` 都在包里。

**电脑要求**：Windows 10/11 x64，约 761 MB 磁盘空间。显卡可选：第一次启动她会读显存、找本机 Ollama 里已有的模型，自己适配；一个模型都没有也能跑，只是不开口。

**开与关**：桌面快捷方式打开的是**控制台**，在里面点「启动桌宠」她才出来；控制台不会自动拉起她。开机自启和自动更新目前没做。

### 这一版做了什么

**变成一个自洽的独立源码仓库**

- 仓库里 `src/` 就是成品源码，不再有「上游蓝本 + 补丁脚本」那一套；`overlay/` 与补丁工具已经删掉，克隆下来直接就能构建出发布结构。
- 构建链为此重写：`build/build.mjs` 把仓库按发布结构铺进 `stage/`（`app`、`launcher`、`standalone`、`defaults`、`assets`、`verify`、`electron`、`node`、`speech`），`build/toolchain.mjs` 负责找三块外部运行时（Electron 43.3.0、node v24.21.0、sherpa-onnx + SenseVoice），可以指向一份已装好的成品，也可以用参数显式指定。
- `build/check-release.mjs` 证明 `stage/` 与仓库逐字节一致；`verify.mjs` 在装好之后自查整树指纹以及一批「绝不该进包」的文件。

**本机控制口加固**

控制台与桌宠之间走的是本机回环上的控制桥，两端都收紧了：

- 桌面侧控制服务现在要求 **token**（`Authorization: Bearer <token>` 或 `X-Pet-Token`），随安装生成到 `helper-control.json`（权限 `0600`），用常数时间比较；没带 token 的写请求一律 `401`，而且不会往页面里写任何东西。
- 去掉了 `Access-Control-Allow-Origin: *`，改成来源白名单（http/https 下的 `127.0.0.1`、`localhost`、`::1`，以及没有 `Origin` 的本机请求）；不认识的来源 `403` 且不回 CORS 头；认识来源回显该 Origin 并带 `Vary: Origin`。
- `OPTIONS` 只作为预检应答；`/health` 保持免鉴权，但只报告 `ok` 和窗口数；键名里含 `__proto__` 的请求被拒。
- 如果 token 文件写不进去，控制桥**失败即关闭**：所有写请求一律拒绝。
- 独立运行器的 HTTP 服务同样处理：来源白名单，`/shutdown` 改成**必须 POST + token**——在此之前，任何网页用一个 `<img>` 标签就能把她关掉。

因为两端是一起改的，控制台和桌宠需要都是 1.1.0；升级后如果控制台提示「控制桥要密钥」，让她重启一次把 token 写出来即可。

**隐私：包里不留本机路径**

- 运行期里写死的作者机器绝对路径已删除：语音识别找 `node.exe` 改成按安装结构推导（发行版里 `electron/electron.exe` 与 `node/bin/node.exe` 是兄弟目录），其余引用改用 `%USERPROFILE%` 这类占位写法。
- 新增构建期门禁 `build/check-paths.mjs`（`npm run paths`），扫描仓库与待打包目录里的本机绝对路径与私人目录；`build/build.mjs` 在铺 `stage/` 前会先跑它。
- 测试代码里不再出现真实用户名，合成路径统一用占位名。

**文档**

- `README.md`（英文）与 `README.zh-CN.md`（中文），另有 [NOTICE.md](../../NOTICE.md)、[SECURITY.md](../../SECURITY.md)、[CONTRIBUTING.md](../../CONTRIBUTING.md) 与 issue 模板。
- [docs/development-log.md](../development-log.md)：开发日志——每一步的动机、改动、验证与提交。
- [docs/differences-from-upstream.md](../differences-from-upstream.md)：与上游 dsh-pet 0.3.0 的逐文件差异（含大小与 SHA-256）。
- [docs/architecture-roadmap.zh-CN.md](../architecture-roadmap.zh-CN.md)：去宿主化与后续安全工作的路线图。

### 兼容性

升级什么都不用改：内部标识（`BlueHairMaid` 应用目录、`dsh-pet` 插件包名、`dsh-pet-electron-helper` 渲染端、`dsh-pet-*` 存储键、`/dsh-pet-7340` 路由前缀、`%APPDATA%\BlueHairMaid` 数据根）都是故意保持不变的，人设、记忆、聊天记录、位置与设置原样继续用。卸载依然不删你的数据。

### 已知限制

- **成品没有代码签名**，Windows SmartScreen 首次运行可能拦一下（「更多信息」→「仍要运行」）。要签名需要什么，见 [docs/code-signing.zh-CN.md](../code-signing.zh-CN.md)。
- 没有开机自启、没有自动更新、也没有免安装器的更新方式。
- **包内**的文件名与文案仍是中文（`安装.cmd`、`卸载.cmd`、`assets\使用说明.txt` 等）：改这些会动到包的布局，留到后面的版本，不混进这一版。
- `src/lib/` 是 `src/src/` 里 TypeScript 的编译产物；要改 TypeScript 得用上游工具链重新构建 `lib/`。
- GitHub 把许可证识别成 `NOASSERTION`：`LICENSE` 是 MIT，只是带了两段版权（上游作者 + 本项目），识别器不认。

### 许可与署名

MIT，见 [LICENSE](../../LICENSE)。上游 MIT 全文以 [`assets/LICENSE.txt`](../../assets/LICENSE.txt) 原样随包分发，原作者署名完整；第三方组件列在 [`assets/第三方声明.txt`](../../assets/第三方声明.txt) 与 [NOTICE.md](../../NOTICE.md)。

桌宠本体源自 **PC2005-cloud** 的 **dsh-pet 0.3.0**：上游发布包 243 个文件里 232 个未改动、11 个是刻意修改（逐个列在 [differences-from-upstream.md](differences-from-upstream.md)），没有删掉上游任何文件；仓库里其余部分都是本项目自己的东西。
