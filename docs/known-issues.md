# Known issues

English summary: defects that are still open in the released builds, with the reproduction, the root
cause and the intended fix. This document is in Chinese.

本文件记录**已经确认、但还没修**的缺陷：现象 → 怎么复现 → 根因 → 打算怎么修。
只记录能在发布版里复现的问题；修好一个就把它挪到本文末尾的「已修复」一节。

判断某个问题有没有修，最直接的办法是看包内那几个文件的**字节大小**（下面每条都写了）。

---

## KI-1（影响最大）便携版 `安装.cmd` 会「一闪而过」，什么提示都没有

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包（`cute-fat-fish-pet-<版本>-win-x64.zip`）；`setup.exe` 安装程序不受影响。
- **现象**：解压后双击 `安装.cmd`，黑色命令行窗口闪一下就没，像什么都没发生；桌面上什么都不会多出来。
- **根因**：`assets\安装.cmd`（285 B）只有一层判断：

  ```bat
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
  if errorlevel 1 (
    echo   [安装没成功] 上面有原因。按任意键关闭。
    pause >nul
  )
  ```

  而当 `install.ps1` 不存在时（最常见的情形：**没解压，直接在压缩包预览窗口里双击了 `安装.cmd`**，
  Windows 只会把被点的那一个文件解到 `%TEMP%\Temp1_xxx.zip\`），Windows PowerShell 的行为是
  **打印一行提示到 stderr、然后以退出码 0 退出** —— 2026-10-08 在本机实测：

  ```
  cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File C:\definitely-missing\install.ps1 & echo [errorlevel=%errorlevel%]"
  → The argument '...' to the -File parameter does not exist. ...
  → [errorlevel=0]
  ```

  退出码 0 ⇒ `if errorlevel 1` 不成立 ⇒ **不会 pause** ⇒ 窗口立刻关闭，用户看不到任何原因。
- **复现**：把 `assets\安装.cmd` 单独复制到一个空文件夹（不放 `install.ps1`），双击它。
- **修法**（下次打包含此改动时生效）：
  1. 开头加存在性检查，缺文件时给出人话提示；
  2. 结束处**无条件** `pause`（不要只在出错时 pause）；
  3. 顺便让提示告诉用户「请先完整解压压缩包」。
- **修好以后**：`assets\安装.cmd` 的字节数会明显大于 285。

## KI-2 便携版装出来的名字和版本还是旧的

- **影响版本**：v1.1.0 的绿色 zip 包（`setup.exe` 不受影响）。
- **现象**：用 zip + `安装.cmd` 装完之后，桌面快捷方式叫「**蓝毛小女仆**」，「设置 → 应用」里登记的版本是「**1.0.0**」。
- **根因**：包内 `assets\install.ps1`（9284 B）里的两行常量没跟着产品走：

  ```powershell
  $DisplayName = "蓝毛小女仆"
  $Version    = "1.0.0"
  ```

  它们被用来创建快捷方式、写注册表卸载项的 `DisplayName`/`DisplayVersion`/`Publisher`。
- **复现**：用 zip 装一次，看桌面快捷方式名字与 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid`。
- **修法**：`$DisplayName` 改成「可爱大肥鱼桌宠」；`$Version` 不要写死，从包内 `app\package.json` 的 `version` 读。
- **注意**：`$AppName = "BlueHairMaid"` 与注册表键名**是内部标识，必须保持不变**（见 `NOTICE.md` 第 5 节）。

## KI-3 `安装.cmd` 里的中文 + `chcp 65001` 会让批处理解析出错

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包。
- **现象**：运行 `安装.cmd` 时，命令窗口里会多出几条莫名其妙的报错，例如

  ```
  '蓝毛小女仆' is not recognized as an internal or external command
  'onPolicy' is not recognized as an internal or external command      ← 其实是 -ExecutionPolicy 被吃掉了一半
  '安装没成功]' is not recognized as an internal or external command
  ```

- **根因**：`.cmd` 文件本身是 UTF-8（无 BOM）且含中文，第 2 行又执行了 `chcp 65001`；`cmd.exe` 按字节解析批处理，
  在代码页切换与多字节字符混在一起时会把后面的行切错（和 `.vbs` 必须写成纯 ASCII 是同一类坑）。
- **复现**：2026-10-08 在本机用 `cmd /c` 跑同一个 `安装.cmd`（不存在的安装源），stderr 里就是上面那三行。
- **修法**：`.cmd` 里只留 ASCII（注释、提示都用英文或直接交给 PowerShell 打印），中文输出全部由 `install.ps1` 负责
  （PowerShell 读 UTF-8 BOM 没问题）。

## KI-4 Windows 会提示「已保护你的电脑」（SmartScreen）

- **不是 bug，是没买代码签名证书的必然结果**，写在这里免得当成故障排查。
- 用户侧：点「更多信息」→「仍要运行」；想核对文件完整性就用 Release 页上的 `.sha256`
  （v1.1.0 的安装包：`6C87705E890D020E95D23040A65F1DA6EB6224DDF4FB156AA1816D295F12C882`）。
- 彻底解决要买 Authenticode 证书（或走 Azure Trusted Signing / SignPath Foundation 这类对开源免费的路子），
  见 `docs/code-signing.zh-CN.md`。

## 已知但属于「设计如此」，不算缺陷

- **没有开机自启、没有自动更新**：要自启就把桌面快捷方式拖进 `shell:startup`；升级方式见 README 的
  「Updating to a newer version」（控制台里的一键更新排在 1.2.0）。
- **GitHub 仓库页显示 `NOASSERTION`**：`LICENSE` 里有两段版权（上游 + 本项目），GitHub 认不出标准模板，
  不改 `LICENSE`。
- **包内文件名与文案仍是中文**：改名要重打包，攒到下一个版本一起做。

---

## 已修复

（还没有条目——修好一条就从上面挪下来，写上修复版本与提交号。）
