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
}
"@
# Without this, a scaled display virtualises the coordinates and the press lands somewhere else.
[OsMouse]::SetProcessDPIAware() | Out-Null
[OsMouse]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 150
[OsMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 150
for ($i = 1; $i -le 8; $i++) { [OsMouse]::SetCursorPos($x + $i * 10, $y + $i * 6); Start-Sleep -Milliseconds 30 }
[OsMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
