# ============================================================================
#  蓝毛小女仆 · 卸载
# ----------------------------------------------------------------------------
#  · 会先请桌宠和控制台退出，然后删掉安装目录、桌面与开始菜单的快捷方式、
#    以及「设置 → 应用」里的登记项。
#  · 你的聊天记录 / 人设 / 设置放在 %APPDATA%\BlueHairMaid\，默认**保留**，
#    这样以后重装还能接着用；想一起删掉就加 -PurgeData。
#
#  用法：双击 卸载.cmd；或 powershell -ExecutionPolicy Bypass -File uninstall.ps1
# ============================================================================
[CmdletBinding()]
param(
  [string]$Target = "",
  [switch]$PurgeData,
  [switch]$Quiet
)

$ErrorActionPreference = "Continue"
$AppName = "BlueHairMaid"
$DisplayName = "蓝毛小女仆"

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }

Say ("-" * 66) "DarkGray"
Say "  $DisplayName · 卸载" "Cyan"
Say ("-" * 66) "DarkGray"
Say ""

# 找安装位置：命令行 > 注册表 > 默认
if ([string]::IsNullOrWhiteSpace($Target)) {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
  if (Test-Path $key) {
    $Target = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).InstallLocation
  }
  if ([string]::IsNullOrWhiteSpace($Target)) { $Target = Join-Path $env:LOCALAPPDATA $AppName }
}
$Target = [System.IO.Path]::GetFullPath($Target)
$dataDir = Join-Path $env:APPDATA $AppName

# 安全阀：万一 $Target 被解析成盘根 / 用户目录，宁可不删目录，也不能乱删
$saneTarget = ($Target.TrimEnd('\').Length -gt 10) -and
  ($Target -notmatch '^[A-Za-z]:\\?$') -and
  ($Target -notmatch '^[A-Za-z]:\\Users\\?$') -and
  ($Target -notmatch '^[A-Za-z]:\\Users\\[^\\]+\\?$')

Say "  安装目录 ：$Target" "White"
Say "  用户数据 ：$dataDir   （$(if ($PurgeData) { '也会一起删' } else { '保留' })）" "DarkGray"
if (-not $saneTarget) { Say "  [!] 这个路径看着不对，为安全起见只清快捷方式与登记项，不删目录。" "Yellow" }
Say ""
if (-not $Quiet) {
  $go = Read-Host "  确认卸载吗？(y/N)"
  if ($go -notmatch '^[yY]') { Say "  已取消。" "Yellow"; exit 0 }
}

# 1. 先停进程
#    判据是「可执行文件本身就在安装目录里」—— 不能用「命令行里出现过这个路径」来判：
#    那样会把参数里凑巧提到该路径的其它 node.exe（甚至别的软件）一起杀掉。实测踩过这个坑。
$procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -in @("electron.exe", "node.exe") -and
    $_.ExecutablePath -and ($_.ExecutablePath -like "$Target*") -and
    ([int]$_.ProcessId -ne $PID)
  })
if ($procs.Count -gt 0) {
  Say "  正在退出桌宠/控制台（$($procs.Count) 个进程）..." "White"
  foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Milliseconds 1500
}

# 2. 快捷方式（只删指向本安装目录的那个，别误删别人同名图标）
$ws = New-Object -ComObject WScript.Shell
$desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "$DisplayName.lnk"
$startDir = Join-Path ([Environment]::GetFolderPath("Programs")) $DisplayName
foreach ($p in @($desktop, (Join-Path $startDir "$DisplayName.lnk"))) {
  if (-not (Test-Path $p)) { continue }
  $pointsHere = $false
  try { $pointsHere = ($ws.CreateShortcut($p).TargetPath -like "$Target*") } catch {}
  if ($pointsHere) {
    Remove-Item $p -Force -ErrorAction SilentlyContinue
    Say "  已删快捷方式 $p" "Green"
  } else {
    Say "  跳过 $p（它指向别处，不是这次装的这个）" "Yellow"
  }
}
if (Test-Path $startDir) {
  $left = @(Get-ChildItem $startDir -Force -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) { Remove-Item $startDir -Recurse -Force -ErrorAction SilentlyContinue }
}

# 3. 注册表登记项
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
if (Test-Path $key) { Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue; Say "  已清掉「设置 → 应用」里的登记项" "Green" }

# 4. 安装目录
if (-not $saneTarget) {
  Say "  安装目录路径可疑，跳过删除：$Target" "Yellow"
} elseif (Test-Path $Target) {
  Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $Target) {
    Say "  [!] 还有文件删不掉（可能被占用），请手动删除：$Target" "Yellow"
  } else {
    Say "  已删除安装目录" "Green"
  }
} else {
  Say "  安装目录不存在，跳过。" "DarkGray"
}

# 5. 用户数据
if ($PurgeData) {
  if (Test-Path $dataDir) {
    Remove-Item $dataDir -Recurse -Force -ErrorAction SilentlyContinue
    Say "  已删除用户数据（人设/记忆/设置）" "Green"
  }
} else {
  Say "  用户数据保留在：$dataDir" "DarkGray"
  Say "  （随时可以手动删；桌宠渲染窗口的临时数据在 %APPDATA%\dsh-pet-electron-helper）" "DarkGray"
}

Say ""
Say "  卸载完成。" "Cyan"
Say ""
if (-not $Quiet) { Read-Host "  按回车关闭这个窗口" | Out-Null }
