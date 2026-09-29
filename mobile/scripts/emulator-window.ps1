# The KAPEVault emulator window, from the PC side (it opens BEHIND other windows, which looks like "stuck").
#   powershell -File scripts/emulator-window.ps1 front    - bring it above other windows (not pinned on top)
#   powershell -File scripts/emulator-window.ps1 shot     - save what the emulator draws (proof/emulator-window.png)
#   powershell -File scripts/emulator-window.ps1 screen   - save what the monitor shows at its place, covered or not
# FLAG_SECURE hides the app from adb screenshots, not from these; for the page itself use webview-probe.mjs.
param([ValidateSet("front", "shot", "screen")][string]$mode = "shot")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class EmuWin {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Ri, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[EmuWin]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { $_.MainWindowTitle -like "Android Emulator*" } | Select-Object -First 1
if (-not $p) { "no emulator window (headless, or not running)"; exit 1 }
$h = $p.MainWindowHandle
if ($mode -eq "front") {
  [EmuWin]::ShowWindow($h, 9) | Out-Null                                                    # restore if minimized
  [EmuWin]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0043) | Out-Null               # topmost...
  [EmuWin]::SetWindowPos($h, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0043) | Out-Null               # ...then normal again
  "in front: $($p.MainWindowTitle)"; exit 0
}
$r = New-Object EmuWin+R
[EmuWin]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Ri - $r.L; $ht = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
if ($mode -eq "screen") {
  $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
} else {
  $dc = $g.GetHdc(); [EmuWin]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
}
$dir = Join-Path $PSScriptRoot "..\proof"; New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir ("emulator-" + $(if ($mode -eq "screen") { "screen" } else { "window" }) + ".png")
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
"saved $out (${w}x${ht}, window at $($r.L),$($r.T))"
