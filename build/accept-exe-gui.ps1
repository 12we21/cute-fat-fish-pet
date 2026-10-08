# End-to-end acceptance of the FINAL installer exe: silent install -> cold start the installed
# console with an isolated APPDATA -> look at what the pet auto-detected -> stop -> uninstall.
# Pure ASCII (non-ASCII only inside comments) and carries a UTF-8 BOM, because PS 5.1 parses a
# .ps1 as ANSI when there is no BOM.
#
# Path convention -- derived from this script's own location, so a fresh clone works anywhere:
#   $root  repo root = parent of the directory holding this file (build\)
#   $acc   scratch area for acceptance runs: <root>\_accept
#          (override the scratch root with BLUEHAIRMAID_ACCEPT_ROOT)
#   $usr   <acc>\exetest -- the fake "new PC" this run installs into and then wipes
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$acc  = if ($env:BLUEHAIRMAID_ACCEPT_ROOT) { $env:BLUEHAIRMAID_ACCEPT_ROOT } else { Join-Path $root "_accept" }
# newest .exe in release\ by LastWriteTime -- never pin a product name or a version
$exe = (Get-ChildItem (Join-Path $root "release\*.exe") |
        Where-Object { $_.Name -notlike "_*" } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
if (-not $exe) { throw "release\ has no .exe -- build the installer first (see build\installer.nsi)" }
$usr = Join-Path $acc "exetest"
$prog = Join-Path $usr "Programs\BlueHairMaid"
$port = 9242
Remove-Item -Recurse -Force $usr -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $usr | Out-Null
"exe = $exe"

# ---------- 1. silent install ----------
$log = Join-Path $usr "install.log"
$cmd = 'cmd.exe /c ""' + $exe + '" /S /D=' + $prog + ' > ' + $log + ' 2>&1 & echo RC=%errorlevel% >> ' + $log + '"'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd } | Out-Null
$t0 = Get-Date
while (-not (Test-Path (Join-Path $prog "Uninstall.exe"))) {
  if (((Get-Date) - $t0).TotalSeconds -gt 240) { throw "install timed out" }
  Start-Sleep -Seconds 5
}
"install: RC line = " + ((Get-Content $log) -join " / ") + "  (" + [int]((Get-Date) - $t0).TotalSeconds + "s)"
"install: files = " + (Get-ChildItem $prog -Recurse -File | Measure-Object).Count

# ---------- 2. cold start, isolated APPDATA ----------
$env:APPDATA = Join-Path $usr "AppData\Roaming"
$env:LOCALAPPDATA = Join-Path $usr "AppData\Local"
Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:DSH_HOME, Env:OLLAMA_HOST, Env:DSH_PET_DATA_DIR -ErrorAction SilentlyContinue
$el = Join-Path $prog "electron\electron.exe"
$p = Start-Process $el -ArgumentList "`"$(Join-Path $prog 'launcher')`"", "--remote-debugging-port=$port" -PassThru
"console pid = $($p.Id)"
Start-Sleep -Seconds 30

$data = Join-Path $env:APPDATA "BlueHairMaid"
"data root        = $data  (exists = $(Test-Path $data))"
"install dir kept clean (no userdata/) = $(-not (Test-Path (Join-Path $prog 'userdata')))"
"device-profile   = $(Test-Path (Join-Path $data 'device-profile.json'))"
if (Test-Path (Join-Path $data 'device-profile.json')) {
  Get-Content (Join-Path $data 'device-profile.json') -Raw
}
"tts-pitch.txt    = $(Get-Content (Join-Path $data 'dsh-pet\tts-pitch.txt') -Raw)"

# ---------- 3. the pet it started ----------
$rt = Join-Path $data "runtime.json"
if (Test-Path $rt) {
  $j = Get-Content $rt -Raw | ConvertFrom-Json
  "pet runtime.json = pid $($j.pid) / port $($j.port) / mode $($j.app) / $($j.provider):$($j.model)"
  $h = Invoke-RestMethod "http://127.0.0.1:$($j.port)/health" -TimeoutSec 5
  "pet /health      = " + ($h | ConvertTo-Json -Compress)
  "pet process alive= " + [bool](Get-Process -Id $j.pid -ErrorAction SilentlyContinue)
} else {
  "!! no runtime.json - the pet did not start"
}

# ---------- 4. the master's pet must be untouched ----------
try { "master 3080  = " + (Invoke-WebRequest "http://127.0.0.1:3080/health" -UseBasicParsing -TimeoutSec 3).StatusCode }
catch { "master 3080  = unreachable ($($_.Exception.Message))" }
"master desktop .lnk count = " + (Get-ChildItem "$env:USERPROFILE\Desktop\*.lnk").Count + "  (13 before install, 14 while installed)"
"CDP console up = " + $(try { (Invoke-WebRequest "http://127.0.0.1:$port/json/version" -UseBasicParsing -TimeoutSec 3).StatusCode } catch { "no" })
# NOTE: the console does NOT auto-start the pet - it waits for the user to click "start pet"
# (that is the first-run behaviour seen in the UI text "点「启动桌宠」"). Drive that click over
# CDP with the DSH workspace helper tools\cdp-do.mjs, then look for runtime.json in the data
# root above.
# Cleanup afterwards: stop the pet (its /shutdown), kill the console, then Uninstall.exe /S.
