# ============================================================================
#  可爱大肥鱼桌宠 · 一键安装（绿色版）
# ----------------------------------------------------------------------------
#  这个脚本做的事（全部只动你自己的用户目录，不需要管理员）：
#    1. 把这一整包文件复制到安装目录（默认 %LOCALAPPDATA%\BlueHairMaid）
#    2. 在桌面和开始菜单各放一个「可爱大肥鱼桌宠」快捷方式
#       （名字和安装程序装出来的那只完全一样，所以两者可以互相覆盖、
#        也可以互相卸载 —— 见下面的 $DisplayName）
#    3. 在「设置 → 应用」里登记一条卸载项（卸载用同目录的 卸载.cmd）
#    4. 问你要不要现在就打开控制台
#  人设、记忆、聊天记录、模型设置全部放在 %APPDATA%\BlueHairMaid\，
#  以后覆盖安装不会丢；想全部装进 U 盘/移动硬盘，就在安装目录放一个空的
#  portable.txt，数据会改放到 安装目录\userdata\。
#
#  用法：双击 安装.cmd 即可。也可以命令行：
#      powershell -ExecutionPolicy Bypass -File install.ps1 -Target "D:\Apps\BlueHairMaid"
# ============================================================================
[CmdletBinding()]
param(
  [string]$Target = "",
  [switch]$NoShortcut,
  [switch]$NoStart,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$AppName    = "BlueHairMaid"
# 对外显示的名字必须和安装程序（build\installer.nsi 的 APP_NAME）一致，
# 否则便携装出来的快捷方式/「应用和功能」里是另一个名字，两者还会互相打架（KI-2）。
$DisplayName = "可爱大肥鱼桌宠"
$Src        = $PSScriptRoot
# 版本号唯一来源 = 包内 app\package.json（和 zip/exe 的产物名同一个来源），
# 不写死 —— 以前写死 "1.0.0"，于是便携安装登记出来的版本号一直是错的（KI-2）。
$Version = ""
try { $Version = (Get-Content (Join-Path $Src "app\package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {}
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = "0.0.0" }

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Line() { Say ("-" * 66) "DarkGray" }

Line
Say "  $DisplayName · 安装" "Cyan"
Line
Say ""

# ---------------------------------------------------------------- 1. 选目录
if ([string]::IsNullOrWhiteSpace($Target)) {
  $Target = Join-Path $env:LOCALAPPDATA $AppName
}
if (-not $Quiet) {
  Say "装到哪里？（直接回车 = 默认）" "White"
  Say "  默认：$Target" "DarkGray"
  $answer = Read-Host "目录"
  if (-not [string]::IsNullOrWhiteSpace($answer)) { $Target = $answer.Trim('"').Trim() }
}
$Target = [System.IO.Path]::GetFullPath($Target)
$SrcFull = [System.IO.Path]::GetFullPath($Src)

Line
Say "  源目录   ：$SrcFull"
Say "  安装目录 ：$Target"
Line
Say ""

# ---------------------------------------------------- 2. 检查源是否完整/空间
foreach ($need in @("electron\electron.exe", "app\package.json", "app\lib\index.js", "launcher\main.js", "standalone\main.mjs")) {
  if (-not (Test-Path (Join-Path $Src $need))) {
    Say "  [x] 源目录不完整，缺少 $need —— 请把压缩包完整解压后再运行。" "Red"
    Say "      （直接双击 安装.cmd 之前，先右键 zip →「全部解压缩…」到一个短路径，" "DarkGray"
    Say "        确认这个文件夹里有 electron、app、install.ps1。）" "DarkGray"
    exit 1
  }
}
$needGB = 3.0
try {
  $drive = (Get-Item $Target -ErrorAction SilentlyContinue)
  if (-not $drive) { $drive = Get-Item ([System.IO.Path]::GetPathRoot($Target)) }
  $freeGB = [math]::Round($drive.PSDrive.Free / 1GB, 1)
  if ($freeGB -lt $needGB) {
    Say "  [!] $($drive.PSDrive.Name) 盘只剩 $freeGB GB，安装需要约 $needGB GB。" "Yellow"
    if (-not $Quiet) {
      $go = Read-Host "  还是要继续吗？(y/N)"
      if ($go -notmatch '^[yY]') { Say "  已取消。" "Yellow"; exit 1 }
    }
  } else {
    Say "  磁盘空间：$($drive.PSDrive.Name) 盘可用 $freeGB GB ✓" "Green"
  }
} catch {}

# ---------------------------------------------------- 3. 已经在跑就先请她停
$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq "electron.exe" -and $_.CommandLine -and ($_.CommandLine -like "*$Target*" -or $_.CommandLine -like "*$SrcFull*") })
if ($running.Count -gt 0) {
  Say "  检测到桌宠/控制台正在运行，先帮你停掉（$($running.Count) 个进程）..." "Yellow"
  foreach ($p in $running) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Milliseconds 800
}

# ---------------------------------------------------------------- 4. 复制
if ($Target.TrimEnd('\') -eq $SrcFull.TrimEnd('\')) {
  Say "  源目录就是安装目录，跳过复制（绿色版直接运行）。" "DarkGray"
} else {
  if (Test-Path $Target) { Say "  目标目录已存在，覆盖更新（你的设置和数据不受影响）。" "DarkGray" }
  else { New-Item -ItemType Directory -Force -Path $Target | Out-Null }
  Say "  正在复制文件（约 700 MB，机械硬盘可能要一两分钟）..." "White"
  $rc = Start-Process -FilePath "robocopy.exe" -ArgumentList @(
    "`"$SrcFull`"", "`"$Target`"", "/E", "/MT:8", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XF", "portable.txt"
  ) -Wait -PassThru -NoNewWindow
  # robocopy: 0 = 没有变化, 1 = 有复制, >=8 = 出错
  if ($rc.ExitCode -ge 8) {
    Say "  [x] 复制失败（robocopy 退出码 $($rc.ExitCode)）。可能目标目录被占用或权限不足。" "Red"
    exit 1
  }
  Say "  文件复制完成 ✓" "Green"
}

# ---------------------------------------------------------------- 5. 快捷方式
$exe   = Join-Path $Target "electron\electron.exe"
$args_ = "`"$(Join-Path $Target 'launcher')`""
$icon  = Join-Path $Target "launcher\pet.ico"
if (-not (Test-Path $icon)) { $icon = $exe }

if (-not $NoShortcut) {
  Say "  正在创建快捷方式..." "White"
  $ws = New-Object -ComObject WScript.Shell
  $targets = @()
  $desktop = [Environment]::GetFolderPath("Desktop")
  if ($desktop) { $targets += (Join-Path $desktop "$DisplayName.lnk") }
  $startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) $DisplayName
  if (-not (Test-Path $startMenu)) { New-Item -ItemType Directory -Force -Path $startMenu | Out-Null }
  $targets += (Join-Path $startMenu "$DisplayName.lnk")
  foreach ($lnkPath in $targets) {
    try {
      # 同名快捷方式已存在：如果它指向别处（别的目录里还装着一份），先改名留档再覆盖
      if (Test-Path $lnkPath) {
        $old = $null
        try { $old = $ws.CreateShortcut($lnkPath).TargetPath } catch {}
        if ($old -and ($old -notlike "$Target*")) {
          $bak = "$lnkPath.bak"
          if (Test-Path $bak) { $bak = "$lnkPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
          Move-Item $lnkPath $bak -Force -ErrorAction SilentlyContinue
          Say "    原来的同名快捷方式指向 $old，已改名留档：$(Split-Path $bak -Leaf)" "Yellow"
        }
      }
      $lnk = $ws.CreateShortcut($lnkPath)
      $lnk.TargetPath       = $exe
      $lnk.Arguments        = $args_
      $lnk.WorkingDirectory = $Target
      $lnk.IconLocation     = "$icon,0"
      $lnk.Description      = "$DisplayName —— 桌面 Q 版蓝发小女仆，双击打开控制台"
      $lnk.Save()
      Say "    ✓ $lnkPath" "Green"
    } catch { Say "    [!] 快捷方式创建失败：$lnkPath （$($_.Exception.Message)）" "Yellow" }
  }

  # 1.0.0 / 1.1.0 的 zip 留下的快捷方式叫「蓝毛小女仆」。重新装一遍之后桌面上会多出
  # 一个旧名图标；只要它还指向这次的安装目录，就改名留档，别让桌面上留两个图标。
  $legacyLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "蓝毛小女仆.lnk"
  if (Test-Path $legacyLnk) {
    $pointsHere = $false
    try { $pointsHere = ($ws.CreateShortcut($legacyLnk).TargetPath -like "$Target*") } catch {}
    if ($pointsHere) {
      $bak = "$legacyLnk.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
      Move-Item $legacyLnk $bak -Force -ErrorAction SilentlyContinue
      Say "    旧版快捷方式「蓝毛小女仆」已改名留档：$(Split-Path $bak -Leaf)" "Yellow"
    }
  }
}

# ---------------------------------------------------------------- 6. 登记卸载
try {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
  New-Item -Path $key -Force | Out-Null
  $unins = Join-Path $Target "卸载.cmd"
  Set-ItemProperty -Path $key -Name "DisplayName"     -Value $DisplayName
  Set-ItemProperty -Path $key -Name "DisplayVersion"  -Value $Version
  Set-ItemProperty -Path $key -Name "Publisher"       -Value "Mikolu · MIT 开源（早期架构来自 PC2005-cloud 的 dsh-pet 0.3.0）"
  Set-ItemProperty -Path $key -Name "InstallLocation" -Value $Target
  Set-ItemProperty -Path $key -Name "DisplayIcon"     -Value "$icon,0"
  Set-ItemProperty -Path $key -Name "UninstallString" -Value "`"$unins`""
  Set-ItemProperty -Path $key -Name "NoModify"        -Value 1 -Type DWord
  Set-ItemProperty -Path $key -Name "NoRepair"        -Value 1 -Type DWord
  Say "  已在「设置 → 应用」里登记卸载项 ✓" "Green"
} catch { Say "  [!] 登记卸载项失败（不影响使用）：$($_.Exception.Message)" "Yellow" }

# ---------------------------------------------------------------- 7. 本机模型
Line
Say "  接下来（第一次打开控制台时会自动帮你检测这台电脑）：" "White"
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) {
  $guess = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $guess) { $ollama = Get-Item $guess }
}
if ($ollama) {
  Say "    ✓ 这台电脑装了 Ollama（本地模型引擎）" "Green"
} else {
  Say "    · 没检测到 Ollama：可以装一个（https://ollama.com/download）让桌宠用本地模型，" "DarkGray"
  Say "      或者在控制台里填一个联网模型的 API Key（DeepSeek 等），两条路都行。" "DarkGray"
}
Say "    · 想开机自动启动：把桌面的快捷方式拖进 启动 文件夹（Win+R 输入 shell:startup）。" "DarkGray"
Line
Say ""

# ---------------------------------------------------------------- 8. 启动
if (-not $NoStart) {
  $go = "y"
  if (-not $Quiet) {
    Say "  现在打开控制台吗？(Y/n)" "White"
    $go = Read-Host " "
  }
  if ($go -notmatch '^[nN]') {
    Start-Process -FilePath $exe -ArgumentList $args_ -WorkingDirectory $Target
    Say "  已经帮你打开控制台了 —— 第一次运行会自动检测本机模型并推荐设置。" "Green"
  }
}
Say ""
Say "  安装完成。以后随时：桌面「$DisplayName」双击打开控制台。" "Cyan"
Say "  聊天记录/人设/设置都在：$(Join-Path $env:APPDATA $AppName)" "DarkGray"
Say ""
if (-not $Quiet) { Read-Host "  按回车关闭这个窗口" | Out-Null }
