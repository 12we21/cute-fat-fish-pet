# NOTICE — 版权、署名与第三方组件

可爱大肥鱼桌宠（她叫「蓝毛小女仆」）
本版由 **Mikolu** 独立开发与维护，发布于 1.1.0。

这份文件回答三件事：**这东西是谁的、用了谁的代码、包里随附了哪些法律文本**。
面向最终用户的通俗版本在 [`assets/使用说明.txt`](assets/使用说明.txt)（第七、八节），
逐组件清单在 [`assets/第三方声明.txt`](assets/第三方声明.txt)。

---

## 1. 本项目

- 以 **MIT** 协议发布，完整条款见 [`LICENSE`](LICENSE)。
- `LICENSE` 里保留**两段版权声明**：
  - `Copyright (c) 2026 PC2005-cloud` —— 上游桌宠 dsh-pet（<https://github.com/PC2005-cloud/dsh-pet>）原作者；
  - `Copyright (c) 2026 Mikolu` —— 本整合发布版。
- 这是一个由 Mikolu 独立开发和维护的桌面宠物项目。特别感谢原作者 PC2005-cloud 在 0.3.0 版本提供的早期基础架构与灵感。

## 2. 上游署名：一个字都没删

上游 dsh-pet 的 MIT 许可全文以 **`assets/LICENSE.txt`** 原样随包分发，未做任何删改；
`assets/第三方声明.txt` 第 1 段保留了上游项目的名称、作者与许可证指向；
`LICENSE` 里同时保留两段版权。

> 打包、铺 `stage\`、出安装程序 / zip 时，`assets/LICENSE.txt` 与 `assets/第三方声明.txt`
> 都必须继续进包。它们是署名义务的载体，不是可选文档。

## 3. 随包分发的第三方组件

| 组件 | 用途 | 许可证 / 说明 |
| --- | --- | --- |
| **Electron 43 + Chromium** | 桌面渲染端、控制台外壳 | MIT（Chromium 部分为 BSD 类许可，详见 Electron 发行包内 `LICENSES.chromium.html`） |
| **Node.js v24**（`node\bin\node.exe`） | 语音识别：SenseVoice 原生插件在 Electron 里加载不了（`External buffers are not allowed`），必须用真 node 跑 | MIT |
| **sherpa-onnx** | 离线语音识别引擎（原生 `.node`/`.dll`） | Apache-2.0 |
| **SenseVoice int8 模型** | 离线语音识别模型 | Apache-2.0 |
| **silero VAD** | 语音活动检测（判断「有没有人在说话」） | MIT |
| **上首软糖体**（`src\assets\fonts\`） | 气泡与聊天窗字体 | 随包分发的字体文件，仅用于本应用界面 |
| **npm 依赖** | 桌宠本体的运行期依赖（随 `src\node_modules\` 分发） | 各自许可证见对应包内 `LICENSE` |
| **表情包 / 动画素材** | `src\assets\memes\`（27 张）、`src\assets\webm\`（106 个） | 本项目素材 |

## 4. 明确**不**随包分发的东西

- **Ollama**：需要你自己安装，并自行拉取模型。
- **联网大模型服务**：任何 OpenAI 兼容接口都是你填地址 + Key 之后由你自己调用。
- **Edge TTS**：用的是微软的在线语音合成服务，走网络，不随包。
- **浏览器 / 录屏软件（OBS 等）**：录屏由你指定的本机软件完成，本应用只负责起停与传路径。

## 5. 内部标识保留声明

对外产品名是「可爱大肥鱼桌宠」，但包名 `dsh-pet`、桌面渲染端包名 `dsh-pet-electron-helper`、
应用目录 / APP_ID `BlueHairMaid`、浏览器存储键 `dsh-pet-*`、本机路由前缀 `/dsh-pet-7340`
以及默认数据目录 `%APPDATA%\BlueHairMaid` **均保持与 1.0.0 一致**。
这不是漏改，而是为了**兼容老用户已有的配置与数据**——改掉任何一项都会让她的配置「搬家」或直接失效。

## 6. 联系方式

有问题、建议或想要的功能，提到本仓库的 Issues 就行。
