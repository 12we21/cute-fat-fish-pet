# 全新用户冷启动验收：隔离数据根 + 装好的那份 + 自动适配 + 启动 + 说一句话
#
# 路径约定（全部从脚本自身位置推导，克隆到哪台机器都能跑）：
#   $root      仓库根 = 本文件（build\accept.ps1）所在目录的上一级
#   $stage     <仓库根>\stage            ← build\build.mjs 铺出来的发布树
#   $accept    验收用临时隔离区，默认 <仓库根>\_accept；认环境变量 BLUEHAIRMAID_ACCEPT_ROOT
#   $newpc     <验收区>\newpc            「一台假新电脑」：装好的那份 + 私有 APPDATA
# 这块目录每次验收都会被清空重建，别把要留的东西放进去。
$ErrorActionPreference = "Continue"
$root  = Split-Path -Parent $PSScriptRoot
$acc   = if ($env:BLUEHAIRMAID_ACCEPT_ROOT) { $env:BLUEHAIRMAID_ACCEPT_ROOT } else { Join-Path $root "_accept" }
$newpc = Join-Path $acc "newpc"
$stage = Join-Path $root "stage"
$inst  = "$newpc\install\BlueHairMaid"
$w     = $env:DSH_WS   # DSH 工作目录（提供 tools\cdp-do.mjs，用来点控制台里的按钮）
if (-not $w) { throw '先设 $env:DSH_WS 指向 DSH 工作目录（里面有 tools\cdp-do.mjs）' }

# node.exe：NODE / DSH_NODE 环境变量 -> PATH 上的 node -> 常见安装位置。
# 这两个 C:\Program Files\... 是 Node.js 官方安装程序在 Windows 上的默认落点（通用的系统级
# 位置，不是任何一台机器的专属路径），只作为最后的兜底候选；找不到就报错退出。
function Get-NodeExe {
  foreach ($p in @($env:NODE, $env:DSH_NODE)) { if ($p -and (Test-Path $p)) { return $p } }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("C:\Program Files\nodejs\node.exe", "C:\Program Files (x86)\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  throw '找不到 node.exe。装一个 Node.js（https://nodejs.org/，默认就装到 C:\Program Files\nodejs），或者设 $env:NODE=<node.exe 全路径>。'
}
$node  = Get-NodeExe

function Stop-AcceptElectron {
  # 只杀命令行里带本隔离目录的 electron（避免误杀主人正在用的那只）
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like "*$newpc*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

Write-Host "=== 0. 把最新的 stage 同步到「装好的那份」==="
robocopy $stage $inst /MIR /MT:8 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XF portable.txt | Out-Null
Write-Host ("  同步完成，exit=" + $LASTEXITCODE)

Write-Host "=== 1. 隔离环境 + 清空数据根（假装新电脑第一次打开）==="
$env:LOCALAPPDATA = "$newpc\AppData\Local"
$env:APPDATA      = "$newpc\AppData\Roaming"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
Stop-AcceptElectron
Start-Sleep -Milliseconds 800
Remove-Item "$env:APPDATA\BlueHairMaid" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  数据根已清空：$env:APPDATA\BlueHairMaid"

Write-Host "=== 2. 冷启动控制台（第一次打开，会在后台自动适配）==="
Start-Process -FilePath "$inst\electron\electron.exe" -ArgumentList "`"$inst\launcher`"", "--remote-debugging-port=9226" -WorkingDirectory "$inst"
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try { $r = Invoke-WebRequest "http://127.0.0.1:9226/json/list" -UseBasicParsing -TimeoutSec 2; if ($r.Content -match '"type":\s*"page"') { break } } catch {}
}
Write-Host ("  CDP 就绪，等了 " + [int]($i * 0.5) + " 秒")

Write-Host "=== 3. 等自动适配写进设置（最多 90 秒）==="
$prof = "$env:APPDATA\BlueHairMaid\device-profile.json"
$st   = "$env:APPDATA\BlueHairMaid\dsh-pet\screen-watch\state.json"
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $prof) { break }
}
Write-Host ("  device-profile.json 出现 = " + (Test-Path $prof) + "，等了 $i 秒")
if (Test-Path $st) {
  $s = Get-Content $st -Raw | ConvertFrom-Json
  Write-Host ("  state.json 本地模型：localModel=" + $s.localModel + "  quipModel=" + $s.quipModel + "  brain=" + $s.brain + "  intervalSec=" + $s.intervalSec + "  maxCallsPerHour=" + $s.maxCallsPerHour)
} else { Write-Host "  !! state.json 不存在" }
if (Test-Path $prof) {
  $p = Get-Content $prof -Raw | ConvertFrom-Json
  Write-Host ("  推荐：chat=" + $p.picks.chat + "  vision=" + $p.picks.vision + "  budgetMB=" + $p.budgetMB + "  numCtx=" + $p.tune.numCtx + "  keepAlive=" + $p.tune.keepAlive)
}

Write-Host "=== 4. 界面上应该自己报出检测结果 ==="
Set-Content -Path "$newpc\probe.js" -Encoding UTF8 -Value @'
const info = await window.pet.appInfo();
const o = await window.pet.options().catch(() => null);
return JSON.stringify({
  firstRun: info.firstRun,
  hasProfile: !!(info.profile && info.profile.picks),
  setupTag: document.getElementById("setupTag").textContent,
  setupLog: document.getElementById("setupLog").textContent.slice(0, 500),
  stateModel: o && o.state ? { local: o.state.localModel, quip: o.state.quipModel, brain: o.state.brain } : null
});
'@
& $node "$w\tools\cdp-do.mjs" 9226 "$newpc\probe.js"

Write-Host "=== 5. 点「启动桌宠」==="
Set-Content -Path "$newpc\start.js" -Encoding UTF8 -Value @'
document.getElementById("start").click();
await new Promise((r) => setTimeout(r, 2500));
return "state=" + document.getElementById("stateText").textContent + " | log=" + document.getElementById("term")?.textContent?.slice(-200);
'@
& $node "$w\tools\cdp-do.mjs" 9226 "$newpc\start.js"
$rt = "$env:APPDATA\BlueHairMaid\runtime.json"
$health = $null
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $rt) {
    try { $j = Get-Content $rt -Raw | ConvertFrom-Json; $h = Invoke-WebRequest "http://127.0.0.1:$($j.port)/health" -UseBasicParsing -TimeoutSec 3; $health = $h.Content; break } catch {}
  }
}
Write-Host ("  /health = " + $health)

Write-Host "=== 6. 让她说一句话（走本机模型，验证打包后能聊天）==="
Set-Content -Path "$newpc\ask.js" -Encoding UTF8 -Value @'
const t0 = Date.now();
const r = await window.pet.ask("在吗？用五个字以内回我");
return JSON.stringify({ r, ms: Date.now() - t0 }).slice(0, 600);
'@
& $node "$w\tools\cdp-do.mjs" 9226 "$newpc\ask.js"

Write-Host "=== 7. 语音环境变量（打包后 addon / 模型 / node 都指向包内）==="
# 这里要 import 的是**装好的那份**里的 paths.mjs，所以路径得按本次隔离目录算出来
$sa = "$inst\standalone"
$saUrl = "file:///" + ($sa -replace '\\', '/')
$pjs = @"
import { resolvePaths, speechEnv, applyEnv } from "$saUrl/paths.mjs";
const p = resolvePaths("$($sa -replace '\\', '/')");
const env = {}; applyEnv(p, env);
console.log(JSON.stringify({ userRoot: p.userRoot, dataRoot: p.dataRoot, speech: speechEnv(p), envKeys: Object.keys(env) }, null, 1));
"@
[System.IO.File]::WriteAllText("$newpc\_paths.mjs", $pjs, (New-Object System.Text.UTF8Encoding($false)))
& $node "$newpc\_paths.mjs"

Write-Host "=== 8. 停掉测试桌宠 + 关掉测试控制台 ==="
Set-Content -Path "$newpc\stop.js" -Encoding UTF8 -Value @'
document.getElementById("stop").click();
await new Promise((r) => setTimeout(r, 4000));
return "state=" + document.getElementById("stateText").textContent;
'@
& $node "$w\tools\cdp-do.mjs" 9226 "$newpc\stop.js"
Stop-AcceptElectron
Start-Sleep -Seconds 2
$left = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like "*$newpc*" }).Count
Write-Host "  残留测试进程 = $left"
Write-Host "  （其余 electron 进程没动：不属于本次隔离目录 $newpc 的一律不碰）"
