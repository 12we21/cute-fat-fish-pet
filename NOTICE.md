# NOTICE — copyright, attribution and third-party components

Cute Fat Fish Pet (the character is called 蓝毛小女仆, "Blue-Haired Little Maid").
Developed and maintained by **Mikolu**; version 1.1.3.

This file answers three questions: **whose work is this, whose code does it use, and which legal texts ship inside the package.** The plain-language version for users is in [`assets/使用说明.txt`](assets/使用说明.txt) (sections 7 and 8); the per-component list is [`assets/第三方声明.txt`](assets/第三方声明.txt).

[中文版见下方](#中文版)

---

## 1. This project

- Released under the **MIT** license; full text in [`LICENSE`](LICENSE).
- `LICENSE` keeps **two copyright lines**:
  - `Copyright (c) 2026 PC2005-cloud` — the upstream desktop pet `dsh-pet` (<https://github.com/PC2005-cloud/dsh-pet>);
  - `Copyright (c) 2026 Mikolu` — this integrated release.
- This is an independent desktop-pet project, developed and maintained by Mikolu. Special thanks to the original author **PC2005-cloud**, whose **dsh-pet 0.3.0** provided the early foundation and the inspiration.

## 2. Upstream attribution: nothing was removed

The upstream MIT text ships **byte-identical** as [`assets/LICENSE.txt`](assets/LICENSE.txt), unmodified. Section 1 of [`assets/第三方声明.txt`](assets/第三方声明.txt) keeps the upstream project's name, author and license reference, and `LICENSE` keeps both copyright lines.

The exact, per-file difference between the upstream 0.3.0 tree and this repository is published in [docs/differences-from-upstream.md](docs/differences-from-upstream.md), including sizes and SHA-256 hashes.

> When laying out `stage\` or building the installer / zip, `assets/LICENSE.txt` and `assets/第三方声明.txt` **must keep shipping**. They carry the attribution obligation; they are not optional documentation.

## 3. Third-party components distributed with the package

| Component | Used for | License / notes |
| --- | --- | --- |
| **Electron 43 + Chromium** | desktop renderer, console shell | MIT (Chromium parts are BSD-style; see `LICENSES.chromium.html` inside the Electron distribution) |
| **Node.js v24** (`node\bin\node.exe`) | speech recognition: the SenseVoice native addon cannot be loaded inside Electron (`External buffers are not allowed`), so a real node is required | MIT |
| **sherpa-onnx** | offline speech recognition engine (native `.node` / `.dll`) | Apache-2.0 |
| **SenseVoice int8 model** | offline speech recognition model | Apache-2.0 |
| **silero VAD** | voice activity detection ("is anyone speaking") | MIT |
| **上首软糖体** (`src\assets\fonts\`) | font used by the bubbles and the chat window | Font file distributed with the package, used only for this application's UI |
| **npm dependencies** | runtime dependencies of the pet engine (shipped inside `src\node_modules\`) | See each package's own `LICENSE` |
| **Memes and animations** | `src\assets\memes\` (27 images), `src\assets\webm\` (106 animations) | This project's own assets |

## 4. Deliberately **not** distributed

- **Ollama** — install it yourself and pull your own models.
- **Online model services** — any OpenAI-compatible endpoint is called by you, with your own key.
- **Edge TTS** — Microsoft's online speech synthesis; used over the network, not shipped.
- **Browsers / screen-recording software (OBS, …)** — recording is performed by software you choose; this application only starts and stops it and passes paths.

## 5. Internal identifiers are kept (on purpose)

The product is called "Cute Fat Fish Pet", but the package name `dsh-pet`, the desktop renderer package `dsh-pet-electron-helper`, the app folder / APP_ID `BlueHairMaid`, the browser storage keys `dsh-pet-*`, the local route prefix `/dsh-pet-7340` and the default data directory `%APPDATA%\BlueHairMaid` **all stay exactly as they were**.

This is not an oversight: renaming any of them would make existing installations lose their configuration and data (or break outright). See the table in [README.md](README.md#internal-identifiers-are-kept-on-purpose-dsh-pet--bluehairmaid).

## 6. Contact

Questions, ideas or feature requests: open an issue in this repository. Security reports: see [SECURITY.md](SECURITY.md).

---

## 中文版

**可爱大肥鱼桌宠**（她叫「蓝毛小女仆」），由 **Mikolu** 独立开发与维护，当前版本 1.1.3。

1. **本项目**：MIT，见 [`LICENSE`](LICENSE)；`LICENSE` 里保留两段版权 —— 上游桌宠 dsh-pet（<https://github.com/PC2005-cloud/dsh-pet>）原作者 `PC2005-cloud`，以及本整合发布版 `Mikolu`。特别感谢原作者在 0.3.0 版本提供的早期基础架构与灵感。
2. **上游署名一个字都没删**：上游 MIT 全文以 [`assets/LICENSE.txt`](assets/LICENSE.txt) **逐字节原样**随包分发；[`assets/第三方声明.txt`](assets/第三方声明.txt) 第 1 段保留上游名称、作者与许可证指向。逐文件差异（含大小与 SHA-256）公开在 [docs/differences-from-upstream.md](docs/differences-from-upstream.md)。
3. **随包分发的第三方组件**：Electron 43 + Chromium（MIT / Chromium 部分 BSD）、Node.js v24（MIT，用于语音识别）、sherpa-onnx（Apache-2.0）、SenseVoice int8 模型（Apache-2.0）、silero VAD（MIT）、上首软糖体（`src\assets\fonts\`）、npm 依赖（随 `src\node_modules\`）、表情包与动画素材（本项目自有）。
4. **明确不随包**：Ollama、联网大模型服务、Edge TTS（微软在线语音合成）、浏览器 / 录屏软件（OBS 等）。
5. **内部标识故意保留**：包名 `dsh-pet`、渲染端包名 `dsh-pet-electron-helper`、应用目录 / APP_ID `BlueHairMaid`、浏览器存储键 `dsh-pet-*`、本机路由前缀 `/dsh-pet-7340`、默认数据目录 `%APPDATA%\BlueHairMaid` 全部保持不变——改了会让老用户的配置与数据「搬家」或直接失效。
6. **联系方式**：问题、建议、想要的功能提到本仓库 Issues；安全问题见 [SECURITY.md](SECURITY.md)。
