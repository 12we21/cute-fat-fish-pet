# ============================================================================
#  可爱大肥鱼桌宠 · 卸载
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
$DisplayName = "可爱大肥鱼桌宠"

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
#    1.0.0 / 1.1.0 的 zip 用的是旧名「蓝毛小女仆」，也一并纳入，
#    否则卸载完桌面上会留一个点不开的死图标。
$ws = New-Object -ComObject WScript.Shell
$desktopDir = [Environment]::GetFolderPath("Desktop")
$programsDir = [Environment]::GetFolderPath("Programs")
$startDir = Join-Path $programsDir $DisplayName
foreach ($n in @($DisplayName, "蓝毛小女仆")) {
  foreach ($p in @((Join-Path $desktopDir "$n.lnk"), (Join-Path $programsDir "$n\$n.lnk"))) {
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
}
foreach ($d in @($startDir, (Join-Path $programsDir "蓝毛小女仆"))) {
  if (Test-Path $d) {
    $left = @(Get-ChildItem $d -Force -ErrorAction SilentlyContinue)
    if ($left.Count -eq 0) { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

# 3. 注册表登记项
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
if (Test-Path $key) { Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue; Say "  已清掉「设置 → 应用」里的登记项" "Green" }

# 4. 安装目录
if (-not $saneTarget) {
  Say "  安装目录路径可疑，跳过删除：$Target" "Yellow"
} elseif (Test-Path $Target) {
  # 这个脚本常常是从安装目录里被双击运行的：cmd 的当前目录就停在安装目录里，
  # 而且 cmd 正读着 卸载.cmd。先把当前目录挪出去，否则 Windows PowerShell 5.1
  # 的 Remove-Item 可能一个文件都不删就失败。
  try { Set-Location -LiteralPath $env:TEMP -ErrorAction Stop } catch {}
  try { [Environment]::CurrentDirectory = $env:TEMP } catch {}
  for ($i = 1; $i -le 3; $i++) {
    # 安装目录顶层那几个 .cmd 先留着：正跑着的那个被 cmd 读着，删掉它 cmd 就没法接着
    # 往下读（窗口会直接消失、连最后的 pause 都没有）。它们交给后台 helper 关门后清掉。
    Get-ChildItem -LiteralPath $Target -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -ne ".cmd" } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    if (-not (Get-ChildItem -LiteralPath $Target -Force -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $Target)) { break }
    Start-Sleep -Milliseconds 700
  }
  if (Test-Path $Target) {
    # 剩下的通常就是「这个窗口自己」那两个文件（被 cmd / PowerShell 占着）。
    # 交给一个隐藏的后台进程：等这个窗口关掉之后，再把整个目录清干净。
    $waitPid = $PID
    try {
      $parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction SilentlyContinue).ParentProcessId
      if ($parentPid) { $waitPid = $parentPid }
    } catch {}
    $quoted = $Target.Replace("'", "''")
    $inner = @"
`$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt `$deadline) {
  if (-not (Get-Process -Id $waitPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 500
for (`$i = 0; `$i -lt 150; `$i++) {
  Remove-Item -LiteralPath '$quoted' -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath '$quoted')) { break }
  Start-Sleep -Milliseconds 800
}
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    $psExe = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
    try {
      Start-Process -FilePath $psExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", $encoded) -WindowStyle Hidden -ErrorAction Stop
      Say "  安装目录里只剩这个窗口自己在用的几个 .cmd，已安排：窗口一关就自动清掉。" "Yellow"
      Say "  （一分钟后还在的话，手动删掉即可：$Target）" "DarkGray"
    } catch {
      Say "  [!] 还有文件删不掉（可能被占用），请手动删除：$Target" "Yellow"
    }
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
