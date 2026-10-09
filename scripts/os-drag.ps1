# A real OS mouse drag (press at x,y in physical screen pixels, move 80,48, release). Playwright's
# synthetic input never reaches Windows' drag-region hit test, so only this proves an overlay
# really stops the window from being dragged through it. Used by e2e-v2.cjs.
param([int]$x, [int]$y)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class OsMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
}
"@
# Without this, a scaled display virtualises the coordinates and the press lands somewhere else.
[OsMouse]::SetProcessDPIAware() | Out-Null
[OsMouse]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 150
# Report which top-level window owns the press point, so a missed press says who took it.
$pt = New-Object OsMouse+POINT; $pt.X = $x; $pt.Y = $y
$top = [OsMouse]::GetAncestor([OsMouse]::WindowFromPoint($pt), 2)
$owner = [uint32]0; [OsMouse]::GetWindowThreadProcessId($top, [ref]$owner) | Out-Null
$title = New-Object System.Text.StringBuilder 256; [OsMouse]::GetWindowText($top, $title, 256) | Out-Null
Write-Output "pid=$owner title=$title at=$x,$y"
[OsMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 150
for ($i = 1; $i -le 8; $i++) { [OsMouse]::SetCursorPos($x + $i * 10, $y + $i * 6) | Out-Null; Start-Sleep -Milliseconds 30 }
[OsMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
