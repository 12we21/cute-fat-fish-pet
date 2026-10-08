# Extract the FINAL zip, install it into an isolated "fake new PC", then cold start.
# (Comments stay ASCII and the file carries a UTF-8 BOM: PowerShell 5.1 parses a .ps1 as
#  ANSI when there is no BOM, which mangles any non-ASCII bytes.)
# Isolation comes from $env:APPDATA / $env:LOCALAPPDATA.
#
# Path convention -- all of it is derived from this script's own location, so a fresh clone
# works on any machine:
#   $root    repo root = parent of the directory holding this file (build\)
#   $acc     scratch area for acceptance runs: <root>\_accept
#            (override the whole scratch root with the env var BLUEHAIRMAID_ACCEPT_ROOT)
#   $fin     <acc>\fin      the extracted zip tree
#   $usr     <acc>\finuser  the fake user profile (private APPDATA / LOCALAPPDATA)
# Every run wipes $fin and $usr and rebuilds them, so keep nothing you want to keep here.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$acc  = if ($env:BLUEHAIRMAID_ACCEPT_ROOT) { $env:BLUEHAIRMAID_ACCEPT_ROOT } else { Join-Path $root "_accept" }
$ver  = (Select-String -Path (Join-Path $root "src\package.json") -Pattern '"version"\s*:\s*"([^"]+)"' |
         Select-Object -First 1).Matches[0].Groups[1].Value
if (-not $ver) { throw "cannot read version from src\package.json" }
# newest .zip in release\ by LastWriteTime: never pin a product name or a version here
$zip  = (Get-ChildItem (Join-Path $root "release\*.zip") |
         Where-Object { $_.Name -notlike "_*" } |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
if (-not $zip) { throw "release\ has no .zip -- run: node build\build.mjs ; python build\mkzip.py" }
$fin  = Join-Path $acc "fin"
$usr  = Join-Path $acc "finuser"
$target = Join-Path $usr "Programs\BlueHairMaid"
$py = if ($env:DSH_PYTHON) { $env:DSH_PYTHON } else { "python" }   # standard library only

Write-Host "== 0. paths =="
"root    = $root"
"version = $ver"
"zip     = $zip"

Write-Host "== 1. clean =="
Remove-Item $fin, $usr -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "== 2. unzip =="
$sw = [Diagnostics.Stopwatch]::StartNew()
& $py -c "import zipfile,sys,os; d=os.path.join(sys.argv[1],'release'); c=[os.path.join(d,n) for n in os.listdir(d) if n.lower().endswith('.zip')]; z=max(c,key=os.path.getmtime); print('zip =', z); zipfile.ZipFile(z).extractall(sys.argv[2])" $root $fin
if ($LASTEXITCODE -ne 0) { throw "unzip failed" }
$sw.Stop(); Write-Host ("unzip {0:N1}s" -f $sw.Elapsed.TotalSeconds)

Write-Host "== 3. install =="
$env:APPDATA = Join-Path $usr "AppData\Roaming"
$env:LOCALAPPDATA = Join-Path $usr "AppData\Local"
New-Item -ItemType Directory -Force -Path $env:APPDATA, $env:LOCALAPPDATA | Out-Null
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$sw.Restart()
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fin "install.ps1") -Target $target -NoShortcut -NoStart -Quiet *> (Join-Path $acc "_install-final.log")
$sw.Stop(); Write-Host ("install exit={0} in {1:N1}s" -f $LASTEXITCODE, $sw.Elapsed.TotalSeconds)

Write-Host "== 4. registry =="
$k = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid"
if (Test-Path $k) {
  $p = Get-ItemProperty $k
  "DisplayName    = $($p.DisplayName)"
  "DisplayVersion = $($p.DisplayVersion)"
  "UninstallString= $($p.UninstallString)"
} else { "!! no uninstall registry key" }

Write-Host "== 5. file counts =="
$n = (& $py -c "import os,sys; print(sum(len(f) for _,_,f in os.walk(sys.argv[1])))" $target)
$m = (& $py -c "import os,sys; print(sum(len(f) for _,_,f in os.walk(sys.argv[1])))" $fin)
"installed files = $n ; zip tree files = $m"
"target = $target"
"APPDATA = $env:APPDATA"
