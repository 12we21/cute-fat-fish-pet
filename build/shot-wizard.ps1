# Screenshot the NSIS installer wizard (pure ASCII on purpose: no BOM here, and PS 5.1 reads a
# .ps1 without a BOM as ANSI, so any Chinese comment would eat quotes and break the script).
#
#   powershell -ExecutionPolicy Bypass -File build\shot-wizard.ps1
#   powershell -ExecutionPolicy Bypass -File build\shot-wizard.ps1 -Next 1 -Out <any-dir>\dir-page.png
#
# -Next N presses "Next" N times first (never presses Install), which is handy to photograph
# the directory page. The window is captured with user32!PrintWindow, because NSIS windows
# have no CDP to talk to.
#
# Path convention -- derived from this script's own location, so a fresh clone works anywhere:
#   $root  repo root = parent of the directory holding this file (build\)
#   -Exe   defaults to the newest .exe in <root>\release\ (by LastWriteTime; never a pinned name)
#   -Out   defaults to <root>\_accept\wizard-shot.png    (override the scratch root with
#          BLUEHAIRMAID_ACCEPT_ROOT)
param(
  [string]$Exe = "",
  [string]$Out = "",
  [int]$Next = 0
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$acc  = if ($env:BLUEHAIRMAID_ACCEPT_ROOT) { $env:BLUEHAIRMAID_ACCEPT_ROOT } else { Join-Path $root "_accept" }
if (-not $Out) { $Out = Join-Path $acc "wizard-shot.png" }
if (-not $Exe) {
  $Exe = (Get-ChildItem (Join-Path $root "release\*.exe") |
          Where-Object { $_.Name -notlike "_*" } |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  if (-not $Exe) { throw "release\ has no .exe -- build the installer first (see build\installer.nsi)" }
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
"exe = $Exe"
"out = $Out"

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 4
$p.Refresh()
"pid=$($p.Id)  hwnd=$($p.MainWindowHandle)  title=$($p.MainWindowTitle)"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
public class Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static void Shot(IntPtr h, string path) {
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    using (var bmp = new Bitmap(w, ht)) {
      using (var g = Graphics.FromImage(bmp)) {
        IntPtr hdc = g.GetHdc();
        PrintWindow(h, hdc, 2);
        g.ReleaseHdc(hdc);
      }
      bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }
  }
}
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms

[Cap]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
for ($i = 0; $i -lt $Next; $i++) {
  (New-Object -ComObject WScript.Shell).SendKeys("{ENTER}")
  Start-Sleep -Milliseconds 1200
}
[Cap]::Shot($p.MainWindowHandle, $Out)
"png = " + (Get-Item $Out).Length + " B"
Stop-Process -Id $p.Id -Force
Start-Sleep -Seconds 1
"still running: " + [bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue)
