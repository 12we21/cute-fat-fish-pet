# 蓝毛小女仆

一个 **DeepSeek Harness** 桌宠插件：**106 个手绘透明动画**、桌面漫步、点击反应，可以接
本地 **Ollama** 或 DSH 会话自带的在线模型聊天，可选看屏幕吐槽。

这个目录是本项目的**插件半侧**。独立 Windows 版（同一个角色，另含离线语音识别、Edge TTS、
控制台和安装包）在仓库根目录，见[根 README](https://github.com/12we21/cute-fat-fish-pet/blob/main/README.zh-CN.md)。

## 安装

```bash
dsh plugin --profile web add github:12we21/cute-fat-fish-pet#path:/src
```

不需要构建：`lib/` 里已经是编好的宿主与客户端产物。

> **注意：这条命令会拉整个仓库的 tarball，约 68 MB。** 106 个动画占了绝大部分。慢网下可能
> 超时，超时就先克隆再用本地路径装：

```bash
git clone --depth 1 https://github.com/12we21/cute-fat-fish-pet
dsh plugin --profile web add ./cute-fat-fish-pet/src
```

## 你会得到什么

- **106 个手绘动画** —— 带真实 alpha 通道的 VP9-alpha `webm`，叠在你的壁纸上。待机呼吸、
  打瞌睡又被惊醒、跳舞、撸猫、吃东西、过节，点一下就有对应的反应。
- **桌面漫步** —— 她自己走来走去，也会看鼠标：拖她、点她，她都会有反应。
- **聊天** —— 在 DSH 网页界面里跟她说话。可以指向本机 **Ollama** 模型，也可以走你当前
  DSH 会话已经在用的在线模型；有一个全局开关切「只用本地 / 只用 DSH / 本地优先」。
- **碎碎念** —— 她能冒一句由你当前会话模型生成的一句话。
- **可选看屏幕** —— 配合内置的原生抓屏组件，她可以看看你屏幕上是什么并吐槽。不开就是不开。

## 这一半**没有**什么

插件是独立版的子集。下面这些只在独立 Windows 版里，插件里没有：

- 离线语音识别（sherpa-onnx + SenseVoice）
- Edge TTS 朗读
- 单页控制台

## 数据放在哪

聊天记忆和你的配置覆盖都在 `$DSH_HOME/dsh-pet/` 下。除非你把聊天指向在线模型，否则没有
任何东西离开你的电脑。

## 关于名字

仓库名、包名和内部标识符仍然是 `cute-fat-fish-pet`、`dsh-pet` 和 `BlueHairMaid`，
**改的只是显示名**。改内部标识符会让现有用户的人设、记忆和设置搬家，所以保持不动 ——
见 [../NOTICE.md](../NOTICE.md) 第 5 节。完整的选项说明在原作者措辞下保留于
[UPSTREAM-README.md](UPSTREAM-README.md)。

## 版权与许可

本插件派生自 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT），
在保留上游版权声明的前提下使用与扩展。上游 README 逐字节保留在
[UPSTREAM-README.md](UPSTREAM-README.md)；归属说明见 [../NOTICE.md](../NOTICE.md) 与
[LICENSE](LICENSE)。

MIT © 2026 PC2005-cloud、Mikolu。

- 仓库 —— <https://github.com/12we21/cute-fat-fish-pet>
- 独立 Windows 版 —— [根 README](https://github.com/12we21/cute-fat-fish-pet/blob/main/README.zh-CN.md)
- 问题反馈 —— <https://github.com/12we21/cute-fat-fish-pet/issues>
