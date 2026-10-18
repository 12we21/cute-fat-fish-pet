# Release notes — Cute Fat Fish Pet 1.2.3

**Bug-fix release.** 2026-10-18 · Windows x64 · MIT · [中文说明见下方](#中文说明)

A patch release for a defect that shipped in 1.2.2 and affects every install: **spoken output was
silent for everyone.** Edge Read Aloud moved its synthesis endpoint in October 2026; the old host
now answers `403 Forbidden` for every request, so the pet's voice (greetings, chat replies, screen
commentary) produced no audio at all. 1.2.2 was built and uploaded without a voice check, which is
why this one exists.

Two fixes, nothing else changed:

1. **Speech synthesis goes through the new endpoint**, with the old one kept as a fallback and the
   trusted token also sent as `Ocp-Apim-Subscription-Key`. Audio is verified byte-for-byte in the
   release gate (see below).
2. **Screen commentary survives a model that ignores the JSON contract.** Local vision models
   (e.g. `qwen2.5vl:3b`) often answer in prose instead of the requested one-line JSON; that used to
   surface as `judge-failed` with no bubble. The host now takes the model's plain text, trims it to
   one short line and speaks it, instead of dropping the round.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.3-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.3/cute-fat-fish-pet-1.2.3-setup.exe) | `347857693` B | `2A2C65D9FC0562F85807E42C5486C20B530DE0EA318FF2D78E56C6A69F69DFB4` |
| [`cute-fat-fish-pet-1.2.3-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.3/cute-fat-fish-pet-1.2.3-win-x64.zip) | `417039455` B | `6F3D2E218A59A4F97F01158FAA3FC572C0690F310D7C2C5BABFC24456F4804DC` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.3-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and if
an older copy is registered it upgrades **that** directory instead of adding a second tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).

## What changed in 1.2.3

**Voice output works again (Edge TTS endpoint migration).**

`app/runtime/electron-helper/main.js` used the legacy `wss://speech.platform.bing.com/.../edge/v1`
host. Since October 2026 that host returns `403` for every handshake, so `pet:tts-speak` failed
silently: the bubble text was correct, the pet just never spoke. The helper now tries
`wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1` first (trusted token passed both as
`TrustedClientToken` and `Ocp-Apim-Subscription-Key`), keeps the old host as a fallback, and only
falls back when the handshake itself failed — a stream that opened and then broke is reported as an
error instead of being retried blindly.

**Screen commentary accepts plain text from the model.**

`swJudge()` required one line of JSON (`{"react":…,"emotion":…,"say":…}`). Small local models often
return prose, which produced `judge-failed` and no bubble. The fallback now extracts the first
sentence, quotes removed, capped at 40 characters, and speaks it with the `thinking` emotion; only a
completely empty answer is still reported as a failure.

Both changes are in files that were already shipped: `src/lib/index.js` (host bundle) and
`src/runtime/electron-helper/main.js` (helper). In the packaged app these are `app/lib/index.js` and
`app/runtime/electron-helper/main.js`, so the standalone app and the DSH plugin form share the fix.

## How this release was verified

1.2.2 shipped without a voice check, so a release gate now exists and must pass before any upload:
`build/acceptance.py` runs 13 checks against the **installed** build — three runtimes, speech models,
animations, uninstaller, `/health`, helper auth, the bubble channel, **real TTS audio bytes**,
chat, screen-watch, and the update feed's asset names. `docs/release-process.zh-CN.md` records the
rules (one release = a batch of fixes; nothing ships before the gate passes; a version number is
published once).

Gate result for this release: **PASS 13/13** (report archived with the release).

## What is affected

- **Standalone app** (this installer / zip): voice output and screen commentary.
- **DSH plugin form**: the same two fixes (plugin updates follow the repository HEAD or the plugin
  marketplace).

Nothing else changed. Memory, persona, configuration and the data directory are untouched by the
upgrade.

## Requirements

Same as 1.2.2: Windows 10/11 x64. The installer and the portable zip both carry their own Electron,
Node and speech runtimes; nothing else needs to be installed. (Local-model chat additionally needs
Ollama, but that is optional.)

## Known limitations

- No code signing certificate yet, so Windows SmartScreen may ask for confirmation on first run.
- Screen-watch still needs a vision-capable model configured in the console's 「联网模型」 settings
  (or a local vision model through Ollama); this release only makes a non-JSON answer usable.
- The `在线 (联网模型)` configuration is stored in plain text under the install directory
  (`standalone\online.json`), as before.

## Updating to a newer version

- **Already on 1.2.0 – 1.2.2:** open the pet console → 「更新」 → 「检查更新」 → 「下载并更新」.
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

1.2.2 里带出去一个影响所有人的缺陷，这一版就是来修它的：**语音不出声了。** 微软在 2026 年 10 月
把 Edge 朗读的合成主机迁走了，旧主机对任何请求都回 `403 Forbidden`，于是桌宠的语音（打招呼、
对话回复、看屏幕点评）全都只有字、没有声音。1.2.2 打包上传时没有验收语音，所以才有这一版。

两处修复，别的没动：

1. **语音合成改走新主机**，旧主机保留作兜底，可信 token 同时作为 `Ocp-Apim-Subscription-Key` 传过去。
   发布闸门里会真的校验合成出来的音频字节数（见下文）。
2. **看屏幕点评对「不按 JSON 回话」的模型做了兜底。** 本地视觉模型（比如 `qwen2.5vl:3b`）经常用
   散文回答而不是要求的一行 JSON，以前这种情况直接记 `judge-failed`、气泡什么都没有；现在会把
   模型的原话去掉引号、压成一行、截 40 字当作点评说出来，只有完全空回复才算失败。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.3-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.3/cute-fat-fish-pet-1.2.3-setup.exe) | `347857693` B | `2A2C65D9FC0562F85807E42C5486C20B530DE0EA318FF2D78E56C6A69F69DFB4` |
| [`cute-fat-fish-pet-1.2.3-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.3/cute-fat-fish-pet-1.2.3-win-x64.zip) | `417039455` B | `6F3D2E218A59A4F97F01158FAA3FC572C0690F310D7C2C5BABFC24456F4804DC` |

每个文件旁边还有一个 `.sha256`（内容格式 `<SHA256>  <文件名>`），用来核对下载是否完整：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.2.3-setup.exe -Algorithm SHA256
```

另外还有一个不带版本号的安装包副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），它的链接永远指向最新一版。

## 安装

双击安装程序即可——不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果机器上已经注册过旧版，
会原地升级那个目录，不会再铺第二份。

绿色包也可以：先解压，然后二选一——双击 `安装.cmd`（建快捷方式 + 卸载项），或直接跑
`standalone\start-pet.vbs`（不写注册表）。

## 这一版改了什么

**语音恢复出声（Edge TTS 主机迁移）。**

`app/runtime/electron-helper/main.js` 原来用的是旧的 `wss://speech.platform.bing.com/.../edge/v1`
主机。2026 年 10 月起这个主机对每次握手都回 `403`，于是 `pet:tts-speak` 静默失败：气泡里的字
是对的，就是没有声音。现在 helper 先连
`wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1`（可信 token 同时作为
`TrustedClientToken` 和 `Ocp-Apim-Subscription-Key`），旧主机留作兜底，并且**只有握手阶段就失败
才换下一个地址**；已经连上又断开的，按错误上报，不盲目重试。

**看屏幕点评接受模型的大白话。**

`swJudge()` 原来要求模型回一行 JSON（`{"react":…,"emotion":…,"say":…}`）。本地小模型经常不照做，
就变成 `judge-failed`、没有气泡。现在兜底会取第一句、去掉引号、压成一行、最多 40 字，用 `thinking`
表情说出来；只有完全空的回复才继续算失败。

这两处都在原本就会发布的文件里：`src/lib/index.js`（宿主半区）与
`src/runtime/electron-helper/main.js`（helper）。打包后的应用里对应
`app/lib/index.js` 与 `app/runtime/electron-helper/main.js`，所以独立版与 DSH 插件版同时拿到修复。

## 这一版怎么验收的

1.2.2 没验语音就发了，所以现在有了发布闸门，没过闸门不许上传：`build/acceptance.py` 对**已安装的
那一份产物**跑 13 项检查——三块运行时、语音模型、动画资源、卸载器、`/health`、helper 鉴权、
气泡通道、**真实 TTS 音频字节**、对话、看屏幕、更新源资产名。规则写在
`docs/release-process.zh-CN.md`（一次发布 = 一批修复；没过闸门不许上传；同一版本号只发一次）。

本版闸门结果：**PASS 13/13**（报告随发布归档）。

## 影响范围

- **独立版应用**（这个安装包 / 绿色包）：语音输出与看屏幕点评。
- **DSH 插件版**：同样两处修复（插件更新跟仓库 HEAD 走，也可以在 DSH 插件市场点更新）。

别的没动。升级不会碰记忆、人设、配置和数据目录。

## 系统要求

与 1.2.2 相同：Windows 10/11 x64。安装包与绿色包都自带 Electron、Node 和语音运行时，不需要额外装东西。
（本地模型聊天另外需要 Ollama，但那是可选项。）

## 已知限制

- 还没有代码签名证书，首次运行可能被 SmartScreen 拦一下。
- 看屏幕仍需先在控制台「联网模型」里配好视觉模型（或通过 Ollama 用本地视觉模型）；这一版只让
  「模型不按 JSON 回」这种情况可用，不改模型选择方式。
- 「在线（联网模型）」配置仍以明文保存在安装目录 `standalone\online.json`（与以前一样）。

## 以后怎么升级

- **已经在 1.2.0–1.2.2：** 打开桌宠控制台 → 「更新」 → 「检查更新」 → 「下载并更新」。
  控制台自己关掉，独立脚本静默装好，桌宠自动开回来。设置和记忆都保留。
- **还在 1.1.4 或更早：** 下载这个安装包手动装一次；1.2.0 之前没有更新器。
- **DSH 插件用户：** 在 DSH 插件市场里更新，或重新跑一次 `dsh plugin add github:12we21/cute-fat-fish-pet`。

## 许可与署名

MIT。第三方声明（Electron、Node.js、sherpa-onnx、SenseVoice、字体、音效）不变，
随发布包放在 `assets/`（见 `第三方声明.txt`），仓库里见 `NOTICE.md`。
