# Cold-start the console that was just installed from the FINAL zip (isolated APPDATA).
# Pure ASCII on purpose (no BOM); prints the pid so the CDP scripts can drive the page.
#
# Path convention -- derived from this script's own location, so a fresh clone works anywhere:
#   $root  repo root = parent of the directory holding this file (build\)
#   $acc   scratch area for acceptance runs: <root>\_accept
#          (override the scratch root with BLUEHAIRMAID_ACCEPT_ROOT)
#   $usr   <acc>\finuser -- the same fake user profile that build\accept-final.ps1 installed into,
#          so run that one (or a run that installed to the same place) BEFORE this script.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$acc  = if ($env:BLUEHAIRMAID_ACCEPT_ROOT) { $env:BLUEHAIRMAID_ACCEPT_ROOT } else { Join-Path $root "_accept" }
$usr  = Join-Path $acc "finuser"
$env:APPDATA = Join-Path $usr "AppData\Roaming"
$env:LOCALAPPDATA = Join-Path $usr "AppData\Local"
Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:DSH_HOME, Env:OLLAMA_HOST, Env:DSH_PET_DATA_DIR -ErrorAction SilentlyContinue
$prog = Join-Path $usr "Programs\BlueHairMaid"
$exe = Join-Path $prog "electron\electron.exe"
$launcher = Join-Path $prog "launcher"
if (-not (Test-Path $exe)) { throw "not installed yet: $exe -- run build\accept-final.ps1 first" }
$p = Start-Process $exe -ArgumentList "`"$launcher`"", "--remote-debugging-port=9241" -PassThru
"console pid = $($p.Id)"
Start-Sleep -Seconds 22
$data = Join-Path $env:APPDATA "BlueHairMaid"
"data root      = $data"
"device-profile = $(Test-Path (Join-Path $data 'device-profile.json'))"
"state.json     = $(Test-Path (Join-Path $data 'state.json'))"
"tts-pitch.txt  = $(Test-Path (Join-Path $data 'dsh-pet\tts-pitch.txt')) -> $(Get-Content (Join-Path $data 'dsh-pet\tts-pitch.txt') -Raw)"
Get-Content (Join-Path $data "device-profile.json") -Raw
