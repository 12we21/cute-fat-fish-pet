# Known issues

English summary: defects that were confirmed in shipped builds, with the reproduction, the root cause
and how they were fixed. Open items come first, then the ones fixed in 1.1.1 (kept for the record).
This document is in Chinese.

本文件记录**已经确认过**的缺陷：现象 → 怎么复现 → 根因 → 怎么修的 / 打算怎么修。
上面几条还没修；下面「已修复」一节留着存档，免得以后又踩回去。

判断某个问题有没有修，最直接的办法是看包内那几个文件的**字节大小**（下面每条都写了）。

---

## KI-4 Windows 会提示「已保护你的电脑」（SmartScreen）

- **不是 bug，是没买代码签名证书的必然结果**，写在这里免得当成故障排查。
- 用户侧：点「更多信息」→「仍要运行」；想核对文件完整性就用 Release 页上每个版本附带的 `.sha256`，
  或直接看 `docs/release-notes-<版本>.md` 里的表格。
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

### KI-1（v1.1.1 修复）便携版 `安装.cmd` 会「一闪而过」，什么提示都没有

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包（`cute-fat-fish-pet-<版本>-win-x64.zip`）；
  `setup.exe` 安装程序不受影响。
- **现象**：解压后双击 `安装.cmd`，黑色命令行窗口闪一下就没，像什么都没发生；桌面上什么都不会多出来。
- **根因**：旧 `assets\安装.cmd`（285 B）只有一层判断 —— 跑 PowerShell，然后 `if errorlevel 1` 才 pause。
  而当 `install.ps1` 不存在时（最常见的情形：**没解压，直接在压缩包预览窗口里双击了 `安装.cmd`**），
  Windows PowerShell 的行为是**打印一行提示到 stderr、然后以退出码 0 退出**：

  ```
  cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File C:\definitely-missing\install.ps1 & echo [errorlevel=%errorlevel%]"
  → The argument '...' to the -File parameter does not exist. ...
  → [errorlevel=0]
  ```

  退出码 0 ⇒ `if errorlevel 1` 不成立 ⇒ **不 pause** ⇒ 窗口立刻关闭，用户看不到任何原因。
- **复现（旧版）**：把旧 `安装.cmd` 单独复制到一个空文件夹（不放 `install.ps1`），双击它。
- **修法（1.1.1）**：`assets\安装.cmd` 285 B → **3,941 B**：
  1. `cd /d "%~dp0"` 之后先用 `if not exist` 检查 `install.ps1`、`electron\electron.exe`、`app\package.json`
     （卸载版查 `uninstall.ps1`）；
  2. 缺件时用 `powershell -EncodedCommand <base64>` 打印一段中文说明（「压缩包没有完整解压」+ 两种正确做法），
     不依赖当前代码页，然后 `exit /b 1`；
  3. 正常路径记下 `%ERRORLEVEL%`，**无条件 `pause`**，最后 `exit /b %RC%`；
  4. 全程纯 ASCII、无 BOM、LF 换行。

### KI-2（v1.1.1 修复）便携版装出来的名字和版本还是旧的

- **影响版本**：v1.1.0 的绿色 zip 包（`setup.exe` 不受影响）。
- **现象**：用 zip + `安装.cmd` 装完之后，桌面快捷方式叫「**蓝毛小女仆**」，「设置 → 应用」里登记的版本是「**1.0.0**」。
- **根因**：包内 `assets\install.ps1`（9,284 B）里的两行常量没跟着产品走：

  ```powershell
  $DisplayName = "蓝毛小女仆"
  $Version    = "1.0.0"
  ```

  它们被用来创建快捷方式、写注册表卸载项的 `DisplayName` / `DisplayVersion` / `Publisher`。
- **复现（旧版）**：用旧 zip 装一次，看桌面快捷方式名字与
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid`。
- **修法（1.1.1）**：`install.ps1` 9,284 B → **11,085 B**：
  - `$DisplayName = "可爱大肥鱼桌宠"`（与安装器 `build\installer.nsi` 的 `APP_NAME` 完全一致）；
  - `$Version` 不再写死，从包内 `app\package.json` 的 `version` 读（读不到才退回 `0.0.0`）；
  - `Publisher` 与安装器的 `APP_PUB` 同一串；缺件提示里补上「先右键 zip →『全部解压缩…』」的说明。
- **顺带修好**：`uninstall.ps1` 5,221 B → **5,543 B**（`$DisplayName` 同步改名）。
  另外，装新版时若桌面上还留着旧名的「蓝毛小女仆」快捷方式、并且它指向这次装的目录，
  就把它改名成 `…lnk.bak-<时间戳>` 留档（不留两个图标）；`uninstall.ps1` 也会清掉指向本安装目录的旧名快捷方式。
- **注意**：`$AppName = "BlueHairMaid"` 与注册表键名**是内部标识，必须保持不变**（见 `NOTICE.md` 第 5 节）。

### KI-3（v1.1.1 修复）`安装.cmd` 里的中文 + `chcp 65001` 会让批处理解析出错

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包。
- **现象**：运行旧 `安装.cmd` 时，命令窗口里会多出几条莫名其妙的报错：

  ```
  '蓝毛小女仆' is not recognized as an internal or external command
  'onPolicy' is not recognized as an internal or external command      ← 其实是 -ExecutionPolicy 被吃掉了一半
  '安装没成功]' is not recognized as an internal or external command
  ```

- **根因**：`.cmd` 文件本身是 UTF-8（无 BOM）且含中文，第 2 行又执行了 `chcp 65001`；`cmd.exe` 按字节解析批处理，
  在代码页切换与多字节字符混在一起时会把后面的行切错（和 `.vbs` 必须写成纯 ASCII 是同一类坑）。
- **修法（1.1.1）**：两个 `.cmd` 现在都是**纯 ASCII、无 BOM、LF 换行**，
  中文提示全部由 PowerShell 打印，并且提示语是用 `-EncodedCommand <base64>` 传进去的，任何代码页都不会乱码。
- **教训**：`.cmd` / `.vbs` 这类「由 Windows 外壳自己解析」的脚本一律写成纯 ASCII；
  中文只放在 PowerShell 脚本、README 和控制台输出里。

### KI-5（v1.1.1 修复）便携版卸载完了，安装目录却整个还在

- **影响版本**：v1.1.0 与 v1.0.0 的绿色 zip 包（只有 zip 里有 `卸载.cmd`；`setup.exe` 用的是 NSIS 自带卸载器，不受影响）。
- **现象**：卸载跑完，日志最后一行是
  `[!] 还有文件删不掉（可能被占用），请手动删除：D:\...`，而安装目录里 **714 个文件一个都没少**。
- **根因**：卸载时 `cmd.exe` 的**当前目录就是安装目录**（Explorer 双击脚本时，CWD = 脚本所在目录），
  而且它正在读取这个目录里的 `卸载.cmd` 自己。Windows 既不允许删除「正被某进程当作当前目录」的目录，
  也不允许删掉 cmd 正在读的批处理文件 ⇒ `Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue`
  在 Windows PowerShell 5.1 下**整体失败**；又因为带了 `-ErrorAction SilentlyContinue`，失败是静默的。
- **证据**：在没有进程占用这棵树的前提下，用同一句命令手动删同一个安装目录 → `错误输出条数：0`、目录消失
  ⇒ 树本身完全可删，问题出在「卸载器自己就在里面跑」。对照实验里，外部 `pwsh` 删一个「有 cmd 停在里面」的目录
  也能删掉，说明单独一个 CWD 不挡删除，是 **CWD + 正在打开着的 `.cmd`** 一起造成的。
- **修法（1.1.1，两个文件）**：
  1. `assets\卸载.cmd` 1,086 B → **1,298 B**：不再 `cd /d "%~dp0"`，改成 `cd /d "%TEMP%"`（失败则退回 `%SystemRoot%`），
     卸载器的当前目录永远不停在安装目录里；仍然是纯 ASCII、无 BOM、LF 换行，仍然无条件 `pause`。
  2. `assets\uninstall.ps1` 5,543 B → **8,191 B**：删目录前先 `Set-Location -LiteralPath $env:TEMP` 并把
     `[Environment]::CurrentDirectory` 也挪出去；最多 3 轮重试，每轮**只删安装目录顶层扩展名不是 `.cmd` 的东西**
     （删掉正在运行的 `卸载.cmd` 会让 cmd 读不下去：实测日志末尾会出现 `系统找不到指定的路径。`，最后的暂停提示也消失）；
     目录清空就删目录；如果只剩那几个 `.cmd`，就起一个**隐藏的分离助手进程**（`powershell -EncodedCommand`），
     等这个窗口（父 cmd 进程）退出之后再删，最多重试 150 × 800 ms，并在窗口里提示
     「安装目录里只剩这个窗口自己在用的几个 .cmd，已安排：窗口一关就自动清掉。」
- **验证**：在新 zip 上跑完整「解压 → 安装 → 卸载」：卸载日志出现新提示 + `卸载完成。` + `请按任意键继续. . .`，
  **窗口退出后第 2 秒整个安装目录消失**（助手进程生效），注册表登记项已清、用户数据保留。

### 修复验证

- `安装.cmd` / `卸载.cmd`：本机冒烟（缺文件路径）实测退出码 1、中文说明逐字正确、`pause` 生效。
- `install.ps1` / `uninstall.ps1`：Windows PowerShell 5.1 `Parser::ParseFile` 解析通过（两个都带 UTF-8 BOM）。
- **安装侧真机（绿色 zip）**：解压新 zip（714 个文件 / 797,858,981 B）→ 双击 `安装.cmd` 真装一次 →
  `python build\verify-install.py stage <安装目录>` **包内该装的 710 个文件逐字节一致（797,834,466 B）**；
  注册表 `DisplayName=可爱大肥鱼桌宠`、`DisplayVersion=1.1.1`、`UninstallString` 指向该目录的 `卸载.cmd`。
- **安装侧真机（setup.exe）**：静默装进空目录（711 个文件 = 该装的 710 个 + 安装时生成的 `Uninstall.exe`）→ 同样
  **710 个文件逐字节一致（797,834,466 B）**、`DisplayVersion=1.1.1`；装出来的 `verify.mjs` 在安装树里自校验 `exit 0`；
  跑 `<安装目录>\Uninstall.exe /S` → 安装目录、登记项、桌面与开始菜单快捷方式都被清掉，`%APPDATA%\BlueHairMaid` 用户数据保留。
- **卸载侧真机**：跑安装目录里的 `卸载.cmd` → 安装目录被完整清掉（见 KI-5），快捷方式与登记项清掉，`%APPDATA%\BlueHairMaid` 用户数据保留。
- **发布门禁**：`node build\check-release.mjs`、`python build\nsi-syntax-check.py`、`python build\mkzip.py`、`python build\mkexe.py` 全部通过；
  包内自带的 `verify.mjs` 在发布树里自校验通过。
