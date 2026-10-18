# Release notes — Cute Fat Fish Pet 1.2.2

**Bug-fix release.** 2026-10-18 · Windows x64 · MIT · [中文说明见下方](#中文说明)

A patch release, because that is the only way the people who already downloaded 1.2.0/1.2.1
can receive it: **the commentary from 「看屏幕点评」(screen watch) never reached the pet's
speech bubble.** It was generated, it was written to the monitoring state file, and it stayed
there. The bubble stayed empty. With work-status display turned on instead, the bubble flashed
and then vanished on its own after nine seconds.

Nothing else changed: same engine, same data directory, same one-click updater, same voice
pipeline. Files that were already correct in 1.2.1 are byte-identical here.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.2-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.2/cute-fat-fish-pet-1.2.2-setup.exe) | `347,884,737` B | `EF02EA6F52D03E8E2451D1FA365055E8E0A2E7B532129521924832BDC020DB20` |
| [`cute-fat-fish-pet-1.2.2-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.2/cute-fat-fish-pet-1.2.2-win-x64.zip) | `417,038,706` B | `D8593761C3B37F69A453938877C83FC6BA13E40CBD56D9659C26AF9F3545829B` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.2-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and if
an older copy is registered it upgrades **that** directory instead of adding a second tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).

## What changed in 1.2.2

**Screen-watch commentary now always goes through the bubble channel.**

The host half used to hand the commentary only to the DSH work-status channel
(`workStatus.setState()` + `workStatus.setTask()`) and to broadcast it to the bubble *only when no
live session competed for the same slot*. With the shipped default configuration both
`workStatusEnabled` and `whisperEnabled` are `false`, so:

- the commentary was computed and stored (`screen-watch/state.json`, `lastResult`), but
- the client skipped the work-status renderer entirely, and
- the broadcast path was never reached, so there was no bubble at all.

When `workStatusEnabled` was turned on by hand, the bubble did appear — and disappeared after nine
seconds, when `workStatus.clear()` fired. That is the "气泡卡一下突然消失" pattern.

1.2.2 makes `swSpeak()` broadcast the commentary unconditionally, in addition to the work-status
write. The emotion animation is unchanged, the work-status channel is unchanged for tools that read
it, and the bubble now shows up with or without work-status display. Only `src/lib/index.js` (the
host bundle) changed — in the packaged app this is the same file, so the standalone and the DSH
plugin form both receive the fix.

Also included since 1.2.1 (repository metadata, no runtime effect):

- `dsh.engines.dsh >= 0.2.0-rc.1` declared in `package.json` and `src/package.json`, so the DSH
  plugin installer can refuse a host that is too old up front.
- README section documenting the plugin data root (`$DSH_HOME/dsh-pet/`) versus the marketplace
  asset root (`$DSH_HOME/pets/`).

## What is affected

- **Standalone app** (this installer / zip): the screen-watch commentary bubble.
- **DSH plugin form** (`dsh plugin add github:12we21/cute-fat-fish-pet`): the same fix, plus the
  engine lower bound; plugin updates follow the repository HEAD and can also be refreshed from the
  DSH plugin marketplace.

Nothing else changed. Memory, persona, configuration and the data directory are untouched by the
upgrade.

## Requirements

Same as 1.2.1: Windows 10/11 x64. The installer and the portable zip both carry their own Electron,
Node and speech runtimes; nothing else needs to be installed. (Local-model chat additionally needs
Ollama, but that is optional.)

## Known limitations

- No code signing certificate yet, so Windows SmartScreen may ask for confirmation on first run.
- Voice input requires the bundled speech runtime (included); the first cold start is slower while
  the SenseVoice model loads.
- Screen-watch needs a vision-capable model configured in the plugin's 「联网模型」 settings (or a
  local vision model through Ollama). This release does not change how the model is chosen.

## Updating to a newer version

- **Already on 1.2.0 or 1.2.1:** open the pet console → 「更新」 → 「检查更新」 → 「下载并更新」.
  The console closes itself, a separate script installs the new version silently, and the pet is
  brought back automatically. Settings and memory are kept.
- **On 1.1.4 or older:** download this installer once and run it; versions before 1.2.0 do not
  contain the updater.
- **DSH plugin users:** update through the DSH plugin marketplace, or re-run
  `dsh plugin add github:12we21/cute-fat-fish-pet`.

## License and attribution

MIT. Third-party notices (Electron, Node.js, sherpa-onnx, SenseVoice, fonts, sounds) are unchanged
and shipped in `assets/` — see `第三方声明.txt` in the release tree and `NOTICE.md` in the repository.

---

## 中文说明

**修 bug 的补丁版。** 2026-10-18 · Windows x64 · MIT

为什么必须发一个版本：**「看屏幕点评」的点评文字从来没有进到桌宠的气泡里。** 文字生成出来了，
也写进了监测状态文件，然后就停在那里——气泡是空的。如果手动打开「工作状态」显示，气泡会闪出来，
九秒后又自己消失。

别的都没动：同一个引擎、同一个数据目录、同一个一键更新、同一套语音。1.2.1 里本来就正确的文件，
这一版逐字节相同。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.2-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.2/cute-fat-fish-pet-1.2.2-setup.exe) | `347,884,737` B | `EF02EA6F52D03E8E2451D1FA365055E8E0A2E7B532129521924832BDC020DB20` |
| [`cute-fat-fish-pet-1.2.2-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.2/cute-fat-fish-pet-1.2.2-win-x64.zip) | `417,038,706` B | `D8593761C3B37F69A453938877C83FC6BA13E40CBD56D9659C26AF9F3545829B` |

每个文件旁边还有一个 `.sha256`（内容格式 `<SHA256>  <文件名>`），用来核对下载是否完整：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.2-setup.exe -Algorithm SHA256
```

另外还有一个不带版本号的安装包副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），它的链接永远指向最新一版。

## 安装

双击安装程序即可——不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果机器上已经注册过旧版，
会原地升级那个目录，不会再铺第二份。

绿色包也可以：先解压，然后二选一——双击 `安装.cmd`（建快捷方式 + 卸载项），或直接跑
`standalone\start-pet.vbs`（不写注册表）。

## 这一版改了什么

**「看屏幕点评」的点评现在一定会走气泡通道。**

以前宿主半区只把点评文字交给 DSH 的工作状态通道（`workStatus.setState()` + `workStatus.setTask()`），
只有在「没有真实会话占用同一个位置」时才顺带广播给气泡。而出厂默认配置里
`workStatusEnabled` 和 `whisperEnabled` 都是 `false`，结果就是：

- 点评算出来了、存进了 `screen-watch/state.json`（`lastResult`），
- 客户端却因为开关是关的，直接跳过了工作状态气泡的渲染，
- 广播那条路也没走到——所以气泡里什么都不会出现。

如果手动把「工作状态」打开，气泡会出来，但九秒后 `workStatus.clear()` 一执行就消失，
这就是「气泡卡一下突然消失」。

1.2.2 让 `swSpeak()` 在写工作状态之外，**无条件**把点评广播给气泡。表情动画不变、工作状态通道不变
（给读它的工具留着），气泡则不管有没有开工作状态显示都会出现。只改了 `src/lib/index.js`（宿主半区），
打包后的应用里是同一个文件，所以独立版和 DSH 插件版同时拿到修复。

另外顺带包含 1.2.1 之后的两处仓库元数据改动（不影响运行）：

- 在 `package.json` 与 `src/package.json` 里声明 `dsh.engines.dsh >= 0.2.0-rc.1`，
  DSH 插件安装器可以提前拒绝过旧的宿主。
- README 补充说明：作为插件安装时数据根是 `$DSH_HOME/dsh-pet/`，而 `$DSH_HOME/pets/` 属于市场资产包，两者不重叠。

## 影响范围

- **独立版应用**（这个安装包 / 绿色包）：看屏幕点评的气泡。
- **DSH 插件版**（`dsh plugin add github:12we21/cute-fat-fish-pet`）：同一修复，外加引擎下限；
  插件更新跟着仓库 HEAD 走，也可以在 DSH 插件市场里点更新。

别的没动。升级不会碰记忆、人设、配置和数据目录。

## 系统要求

与 1.2.1 相同：Windows 10/11 x64。安装包与绿色包都自带 Electron、Node 和语音运行时，不需要额外装东西。
（本地模型聊天另外需要 Ollama，但那是可选项。）

## 已知限制

- 还没有代码签名证书，首次运行可能被 SmartScreen 拦一下。
- 语音输入依赖包里自带的语音运行时（已内置）；首次冷启动加载 SenseVoice 模型会慢一些。
- 看屏幕需要先在插件的「联网模型」里配好视觉模型（或通过 Ollama 用本地视觉模型）。这一版不改模型选择方式。

## 以后怎么升级

- **已经在 1.2.0 / 1.2.1：** 打开桌宠控制台 → 「更新」 → 「检查更新」 → 「下载并更新」。
  控制台自己关掉，独立脚本静默装好，桌宠自动开回来。设置和记忆都保留。
- **还在 1.1.4 或更早：** 下载这个安装包手动装一次；1.2.0 之前没有更新器。
- **DSH 插件用户：** 在 DSH 插件市场里更新，或重新跑一次 `dsh plugin add github:12we21/cute-fat-fish-pet`。

## 许可与署名

MIT。第三方声明（Electron、Node.js、sherpa-onnx、SenseVoice、字体、音效）不变，
随发布包放在 `assets/`（见 `第三方声明.txt`），仓库里见 `NOTICE.md`。
