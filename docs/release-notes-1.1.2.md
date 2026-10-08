# Release notes — Cute Fat Fish Pet 1.1.2

**Fix release.** 2026-10-09 · Windows x64 · MIT · [中文说明见下方](#中文说明)

1.1.1 made the portable zip install and uninstall on a double-click. 1.1.2 fixes one thing that
made the **online model** unusable in chat: she used to say her **thinking process** out loud.

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.2-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.2/cute-fat-fish-pet-1.1.2-setup.exe) | `347760952` B | `A35571AF44F2ED27C6512528B4B4785DA67C663FDAE60001CCF7C87E795D160D` |
| [`cute-fat-fish-pet-1.1.2-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.2/cute-fat-fish-pet-1.1.2-win-x64.zip) | `416993754` B | `F4F9B684C5BBA85A46471C19E4E0BB7EAB43EE9346472550EBAC2FEACD1A04E5` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`). Check a download with:

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.2-setup.exe -Algorithm SHA256
```

There is also a version-less copy of the installer (`cute-fat-fish-pet-setup.exe`, identical bytes)
whose link always points at the latest release.

## Install

Double-click the setup — no admin rights, installs to `%LOCALAPPDATA%\BlueHairMaid` by default, and
if an older copy is registered it upgrades **that** directory instead of adding a second ~761 MB tree.

The portable zip works too: unpack it first (right-click → *Extract All…*), then either double-click
`安装.cmd` (shortcuts + uninstall entry) or run `standalone\start-pet.vbs` (no registry writes).
That whole path was the subject of 1.1.1 — see [release notes 1.1.1](release-notes-1.1.1.md).

## What changed in 1.1.2

**Symptom.** With the brain set to 「在线（联网模型）」 or 「自动择优」 and an OpenAI-compatible
endpoint configured (the one DeepSeek endpoint is what shipped as the default), her replies in the
console chat were a wall of reasoning text instead of a line.

**Root cause, measured.** DeepSeek's current models (`deepseek-flash`, `deepseek-v4-pro`) are
*thinking* models: they emit a separate `reasoning_content` field before the answer. On a short budget
— exactly the pet's case, it wants 20–40 characters — the reasoning eats the whole budget and
`content` comes back **empty** (measured: 20-token budget → 0 characters of answer, 556 characters of
thinking). `standalone/online.mjs` handled "no content" by **falling back to `reasoning_content`**,
so the reasoning was spoken as her line.

**Fix 1 — turn thinking off at the endpoint.** For `api.deepseek.com` the request now carries
`"thinking": {"type": "disabled"}` (never for `reasoner` models; other OpenAI-compatible endpoints do
not get this field, so nothing else changes). The same one-liner went from 400 tokens burned on
thinking to **2 tokens** and a real answer: 「辛苦啦，快靠过来，我给你充充电～」.

**Fix 2 — never speak thinking again.** If a response still has only `reasoning_content` and no
content, `online.mjs` now returns an honest error (`thinking-only`, 「联网模型只想了、没写正文：把预算
调大，或在控制台换一个不思考的模型」) instead of narrating it. This matches what the local path has
always done (`app/lib/index.js:431`, and the helper's `pet:local-quip` which only returns an error
code).

**Fix 3 — string-shaped messages.** `toOpenAIMessages` accepted only array-shaped `content`; a plain
string silently became an **empty prompt** (and the model then answered something unrelated). It now
accepts strings too.

**Also:** version 1.1.2 in the four `package.json` files and the `!define APP_VER` default of
`build\installer.nsi`. The `README.md` shipped inside the package still names no version, so a future
release does not have to repack just for a version string.

## What is affected

- **Online models only** (the console's 「联网模型」 page, with the brain on 「在线」 or 「自动择优」).
- Local Ollama models are untouched — that path never spoke thinking; with a thinking model on a short
  budget it reports 「本机模型没返回文本」 instead of narrating.
- The 1.1.1 portable-zip install/uninstall behaviour is unchanged.

## Requirements

Windows 10/11 x64, about 761 MB unpacked. A GPU is optional; local models run on Ollama if you have it.

## Known limitations

- The installer is **not code-signed**, so SmartScreen shows "Windows protected your PC" once
  (*More info* → *Run anyway*). SHA-256 hashes are the integrity check.
- No auto-start, no auto-update yet (a one-click update in the console is planned for 1.2.0).
- File names and in-app text are still Chinese; the repository and the GitHub page are English-first.
- `src/lib/` is a build product of `src/src/`; GitHub reports the license as NOASSERTION (MIT is in
  `LICENSE`, and the upstream notices are kept).
- Observed, not introduced by this release: that DeepSeek endpoint occasionally returned content
  unrelated to the prompt (two occurrences while testing; unrelated requests, same key).

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
reason in [differences-from-upstream.md](differences-from-upstream.md)), and no upstream file was
deleted. `assets/第三方声明.txt` inside the package lists every bundled component.

---

## 中文说明

**修复版。** 2026-10-09 · Windows x64 · MIT

1.1.1 让绿色 zip 包「解压 → 双击 `安装.cmd`」第一次就能装成功；1.1.2 只修一件事：**联网模型会在聊天里
把「思考过程」整段念出来**，这一版让她闭嘴想、只说话。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.1.2-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.2/cute-fat-fish-pet-1.1.2-setup.exe) | `347760952` B | `A35571AF44F2ED27C6512528B4B4785DA67C663FDAE60001CCF7C87E795D160D` |
| [`cute-fat-fish-pet-1.1.2-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.1.2/cute-fat-fish-pet-1.1.2-win-x64.zip) | `416993754` B | `F4F9B684C5BBA85A46471C19E4E0BB7EAB43EE9346472550EBAC2FEACD1A04E5` |

每个文件都有一个 `.sha256` 同名文件（格式 `<SHA256>  <文件名>`）。核对下载：

```powershell
Get-FileHash .\cute-fat-fish-pet-1.1.2-setup.exe -Algorithm SHA256
```

另外还有一份去掉版本号的安装器副本（`cute-fat-fish-pet-setup.exe`，字节完全相同），那个链接永远指向最新版。

## 安装

双击安装器就行：不需要管理员权限，默认装到 `%LOCALAPPDATA%\BlueHairMaid`；如果检测到已登记的旧版本，
会**装回同一个目录**，不会再铺一份 761 MB。

绿色包也一样：先右键 →「全部解压缩…」，然后二选一 —— 双击 `安装.cmd`（建快捷方式 + 登记卸载），
或者跑 `standalone\start-pet.vbs`（不写注册表）。这条路的修复见 [1.1.1 发布说明](release-notes-1.1.1.md)。

## 这一版改了什么

**现象。** 大脑选「在线（联网模型）」或「自动择优」、并配了 OpenAI 兼容端点（默认填的就是 DeepSeek 的地址）时，
控制台里的对话回过来的是一大段推理文字，而不是一句话。

**根因（实测）。** DeepSeek 现在的模型（`deepseek-flash`、`deepseek-v4-pro`）都是**思考型**：先输出一段独立的
`reasoning_content`，再写正文。而桌宠要的是 20~40 字的短句，预算给得小 —— 实测 20 token 预算下**正文 0 字、
思考 556 字**，正文直接是空的。`standalone/online.mjs` 遇到「正文为空」时**退而把 `reasoning_content` 当回答**，
于是思考就变成了她的台词。

**修法 1 — 在端点上直接关掉思考。** 对 `api.deepseek.com` 的请求体现在带 `"thinking": {"type": "disabled"}`
（`reasoner` 类不加；别的 OpenAI 兼容端点不发这个字段，所以不影响其他服务）。同一句话从「400 token 全烧在思考」
变成 **2 个 token** 直接回答：「辛苦啦，快靠过来，我给你充充电～」。

**修法 2 — 再也不把思考念出来。** 如果响应仍然只有 `reasoning_content`、没有正文，`online.mjs` 现在如实报错
（`thinking-only`：「联网模型只想了、没写正文：把预算调大，或在控制台换一个不思考的模型」），而不是把它念出来。
这与本地那条路一直以来的做法一致（`app/lib/index.js:431`，以及 helper 的 `pet:local-quip` 只回错误码）。

**修法 3 — 字符串形状的消息。** `toOpenAIMessages` 以前只认数组形状的 `content`，传纯字符串会被静默变成**空 prompt**
（模型于是答非所问）；现在也接受字符串。

**另外：** 四个 `package.json` 与 `build\installer.nsi` 的 `!define APP_VER` 默认值都升到 1.1.2；
包内的 `README.md` 仍然不写死版本号，以后发版不必为了版本字符串重打包。

## 影响范围

- **只有联网模型这条路**（控制台「联网模型」页，且大脑在「在线」或「自动择优」）。
- 本地 Ollama 不受影响 —— 那条路本来就只读正文；思考型模型在短预算下它会报「本机模型没返回文本」，不会念思考。
- 1.1.1 的绿色包安装/卸载行为不变。

## 系统要求

Windows 10/11 x64，解压后约 761 MB。显卡可选；本地模型走你已经装好的 Ollama。

## 已知限制

- 安装器**没有代码签名**，所以 SmartScreen 会拦一次（「更多信息」→「仍要运行」）。完整性请用 SHA-256 核对。
- 没有开机自启，也还没有自动更新（控制台里的一键更新排在 1.2.0）。
- 包内文件名与文案仍是中文；仓库与 GitHub 页面以英文为主。
- `src/lib/` 是 `src/src/` 的构建产物；GitHub 会把许可识别成 NOASSERTION（MIT 在 `LICENSE` 里，上游声明都保留着）。
- 顺带记录的观察（不是这一版引入的）：那个 DeepSeek 端点偶发返回与提问无关的内容（测试期间撞到两次，与密钥/请求无关）。

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
[differences-from-upstream.md](differences-from-upstream.md)），没有删掉上游任何文件。
包内 `assets/第三方声明.txt` 列了所有随包分发的组件。
