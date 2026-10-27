# Release notes — Cute Fat Fish Pet 1.2.4

**Small-model + local-backend compatibility release.** 2026-10-27 · Windows x64 · MIT · [中文说明见下方](#中文说明)

This release is about the half of the pet that talks back: how well she works with **small local
models** (3B–8B, the ones most people can actually run) and with **local backends other than
Ollama**. Nothing user-visible changed in the animations, the console layout or the updater.

## What changed in 1.2.4

**1. Other local backends besides Ollama are supported.**

The local-model half used to speak only Ollama's native API (`/api/generate`). It now detects what
`localApi` actually points at (cached for 60 s) and speaks the matching protocol:

- **Ollama** — native `/api/generate`, unchanged path (keep-alive and context options added).
- **OpenAI-compatible** — `/v1/chat/completions`: LM Studio, vLLM, llama.cpp server's `/v1`,
  KoboldCpp, SGLang, Text Generation WebUI's OpenAI layer, and anything else that answers that
  shape. If the model name is blank, the first model from `/v1/models` is used.
- **llama.cpp server** — native `/completion`.

`screen-watch/state.json` also accepts `localKind: "ollama" | "openai" | "llamacpp"` to skip the
auto-detection. Vision (screen watching) still requires an Ollama vision model; other frameworks
now fail with an explicit explanation instead of a misleading "can't see the screen".

**2. Small models (3B–8B) get a compatibility layer.**

- **Output polish**: markdown markers, wrapping quotes and "好的，" openers are stripped, and only
  the first two sentences are kept (capped at ~120 characters). This is display-side only — the
  model still does the thinking.
- **Shorter chat context**: when the backend model is a 3B/4B/7B/8B one, only the last four turns
  are sent, each clipped to 90 characters. Short and recent beats long and stale for this class.
- **Thinking-model budget escalation**: reasoning small models (tested `qwen3:4b`) spent the whole
  `num_predict` budget on internal reasoning and returned an empty body. The pet now retries with
  1800 → 4000 tokens and an explicit "answer directly" instruction. Verified fixed.
- **Faster first word / fewer "can't connect" moments**: requests now send `keep_alive: 10m` so
  Ollama does not unload the model after five idle minutes, and a refused connection is retried
  once before reporting.
- **Error messages say what to do**: Ollama not running / model not pulled / request timed out /
  another backend not started each get their own message (including the address that failed).

## Downloads

| File | Size | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.4-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.4/cute-fat-fish-pet-1.2.4-setup.exe) | `347888074` B | `A699E19D275424E39E9B636BA3E4E4417664B94D3EBF23D7CD576232287F2AD7` |
| [`cute-fat-fish-pet-1.2.4-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.4/cute-fat-fish-pet-1.2.4-win-x64.zip) | `417043131` B | `44E2E6B8F6838288413B4D124F3A911CFE0AC896C53C2AF83CB1C678BAC41F96` |

Each file also has a `.sha256` companion (`<SHA256>  <filename>`), and a version-less
`cute-fat-fish-pet-setup.exe` always points at the latest release.

## How this release was verified

Beyond the usual build/verify gates, 1.2.4 was tested black-box through the running pet: six
scenarios were driven through `POST /chat`, with mock OpenAI-compatible and llama.cpp servers plus
the real local Ollama:

| Scenario | Result |
| --- | --- |
| OpenAI-compatible backend (mock LM Studio) | reply OK, small-model polish applied |
| llama.cpp native `/completion` (mock) | reply OK, polished |
| Unreachable backend | explicit error naming the address and the backends to check |
| Ollama `qwen2.5vl:3b` | reply OK |
| Ollama `qwen3:4b` (reasoning small model) | reply OK after budget escalation (was empty before) |
| Forced `openai` mode against Ollama's real `/v1` | reply OK |

The release acceptance gate (`build/acceptance.py`) still has to pass on the packaged installer
before upload; the result is archived with the release.

## Requirements and limitations

- Same as 1.2.3: Windows 10/11 x64; installer and zip carry their own Electron, Node and speech
  runtimes.
- **Screen watching still needs an Ollama vision model** (`qwen2.5vl:3b` etc.). Other local
  frameworks can chat but cannot look at the screen yet.
- Non-Ollama backends were verified against mock servers for the protocol shape plus one real
  service (Ollama's OpenAI-compatible endpoint); LM Studio and llama.cpp themselves were not
  installed on the test machine.
- Streaming is not used (requests are non-streaming, as before).

## Updating

- **On 1.2.0–1.2.3:** console → 「更新」 → 「检查更新」 → 「下载并更新」. Settings/memory kept.
- **On 1.1.4 or older:** install once by hand; older versions have no updater.
- **DSH plugin users:** update through the plugin marketplace or re-run
  `dsh plugin add github:12we21/cute-fat-fish-pet`.

## License

MIT. Third-party notices unchanged (`第三方声明.txt` in the release tree, `NOTICE.md` in the repo).

---

## 中文说明

**小模型 + 本地后端兼容版。** 2026-10-27 · Windows x64 · MIT

这一版只动「她会说话」的那半边：**对小型本地模型（3B–8B，大多数人真正跑得动的那一档）更友好**，
并且**本机模型不再只认 Ollama**。动画、控制台布局、更新器都没有变化。

## 这一版改了什么

**1. 支持 Ollama 以外的本地框架。**

以前本机模型只能走 Ollama 原生接口（`/api/generate`）。现在会自动识别 `localApi` 指向的是哪种服务
（结果缓存 60 秒），再用对应协议说话：

- **Ollama**：原生 `/api/generate`，路径不变（新增 keep-alive 与上下文参数）。
- **OpenAI 兼容口**：`/v1/chat/completions`——LM Studio、vLLM、llama.cpp server 的 `/v1`、
  KoboldCpp、SGLang、Text Generation WebUI 的 OpenAI 层，以及任何实现了这个形状的服务。
  模型名留空时自动用 `/v1/models` 里的第一个。
- **llama.cpp server**：原生 `/completion`。

`screen-watch/state.json` 里也可以写 `localKind: "ollama" | "openai" | "llamacpp"` 跳过自动识别。
**看屏幕（视觉）仍然需要 Ollama 的视觉模型**；其它框架现在会明确说明「这个后端暂时看不了图」，
不再含糊地报「看不了屏幕」。

**2. 给小型模型（3B–8B）加了一层兼容处理。**

- **输出收尾**：去掉 markdown 标记、包裹的引号和「好的，」这类开场，只保留前两句（约 120 字内）。
  只影响显示，思考仍由模型自己完成。
- **缩短对话上下文**：后端是小模型（3B/4B/7B/8B）时，只带最近 4 轮、每条截到 90 字。对这一档来说，
  短而近的上下文比长而旧的好用。
- **思考型小模型的预算升级**：思考型小模型（实测 `qwen3:4b`）会把 `num_predict` 全烧在内部思考上、
  正文为空。现在会按 1800 → 4000 token 逐档重试并明确要求「直接给最终答案」。实测已修复。
- **首句更快 / 少出现「连不上」**：请求现在带 `keep_alive: 10m`，Ollama 不会在空闲 5 分钟后卸载模型；
  连接被拒会先自动重试一次再报错。
- **错误提示能照做**：Ollama 没开 / 模型没拉下来 / 请求超时 / 其它后端没启动，各有各的说法
  （并且带上实际请求的地址）。

## 下载

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| [`cute-fat-fish-pet-1.2.4-setup.exe`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.4/cute-fat-fish-pet-1.2.4-setup.exe) | `347888074` B | `A699E19D275424E39E9B636BA3E4E4417664B94D3EBF23D7CD576232287F2AD7` |
| [`cute-fat-fish-pet-1.2.4-win-x64.zip`](https://github.com/12we21/cute-fat-fish-pet/releases/download/v1.2.4/cute-fat-fish-pet-1.2.4-win-x64.zip) | `417043131` B | `44E2E6B8F6838288413B4D124F3A911CFE0AC896C53C2AF83CB1C678BAC41F96` |

每个文件旁边还有一个 `.sha256`（格式 `<SHA256>  <文件名>`）；不带版本号的
`cute-fat-fish-pet-setup.exe` 永远指向最新一版。

## 这一版怎么验证的

除了常规的构建/校验门禁，1.2.4 是通过「跑起来的桌宠」黑盒验证的：用模拟的 OpenAI 兼容服务、
模拟的 llama.cpp 服务，加上真实的本地 Ollama，共 6 个场景通过 `POST /chat` 驱动：

| 场景 | 结果 |
| --- | --- |
| OpenAI 兼容后端（模拟 LM Studio） | 回复正常，小模型收尾生效 |
| llama.cpp 原生 `/completion`（模拟） | 回复正常，已收尾 |
| 连不上的后端 | 明确报错，带地址和该检查的后端 |
| Ollama `qwen2.5vl:3b` | 回复正常 |
| Ollama `qwen3:4b`（思考型小模型） | 预算升级后回复正常（之前是空正文） |
| 强制 `openai` 模式打 Ollama 真实 `/v1` | 回复正常 |

上传前仍然必须让发布闸门（`build/acceptance.py`）在打包好的安装包上 PASS；验收结果随发布归档。

## 系统要求与限制

- 与 1.2.3 相同：Windows 10/11 x64；安装包与绿色包都自带 Electron、Node 和语音运行时。
- **看屏幕仍需要 Ollama 视觉模型**（`qwen2.5vl:3b` 之类）。其它本地框架可以聊天，但暂时看不了屏幕。
- 非 Ollama 后端用模拟服务验证了协议形状，并用真实服务（Ollama 的 OpenAI 兼容口）验证过一次；
  测试机没有安装 LM Studio 与 llama.cpp 本体。
- 不使用流式（请求仍是完整返回，和以前一样）。

## 以后怎么升级

- **已经在 1.2.0–1.2.3：** 打开桌宠控制台 → 「更新」 → 「检查更新」 → 「下载并更新」，设置与记忆保留。
- **还在 1.1.4 或更早：** 下载安装包手动装一次；1.2.0 之前没有更新器。
- **DSH 插件用户：** 在插件市场更新，或重新跑一次 `dsh plugin add github:12we21/cute-fat-fish-pet`。

## 许可

MIT。第三方声明不变（发布包里的 `第三方声明.txt`，仓库里的 `NOTICE.md`）。
