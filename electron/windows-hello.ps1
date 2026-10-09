# Windows Hello bridge for KAPEVault (Windows PowerShell 5.1, WinRT KeyCredentialManager).
# Node prepends $Op and $Challenge, then runs this as command text on stdin: in the installed app the
# file sits inside app.asar, which powershell.exe cannot read. Prints exactly ONE JSON line.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Constrained Language Mode (AppLocker / WDAC script rules, __PSLockdownPolicy) blocks the .NET calls
# below, [Console] included, so this is the one answer given without them. Node tells the user the PC's
# policy blocks Hello, instead of a misleading "not set up".
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { Write-Output '{"status":"Constrained"}'; return }

function Write-Result($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)) }

try {
  if ($Op -notin @('supported', 'create', 'sign', 'delete')) { throw 'Unknown operation' }
  if ($Challenge -notmatch '^[A-Za-z0-9+/]*={0,2}$') { throw 'Bad challenge' }

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskAll = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
  $asTaskOp = ($asTaskAll | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $asTaskAction = ($asTaskAll | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
  function Await($op, [Type]$t) { $task = $asTaskOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
  function Await-Action($op) { $task = $asTaskAction.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

  [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.IBuffer, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
  $Manager = [Windows.Security.Credentials.KeyCredentialManager]
  # A buffer WinRT hands back is a bare __ComObject that PowerShell's binder will not pass as an IBuffer;
  # calling ToArray through reflection does the cast (tested). Input goes in as a managed AsBuffer.
  $BufferExt = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]
  $ToArray = $BufferExt.GetMethod('ToArray', [Type[]]@([Windows.Storage.Streams.IBuffer]))
  $Name = 'KAPEVault'

  # The Hello dialog can open behind KAPEVault. A background thread brings it forward once it appears.
  # Only a convenience: a failure (csc.exe blocked, antivirus, AppLocker DLL rules) must never fail Hello.
  function Start-FocusWatch {
    try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class KAPEVaultHelloFocus {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
  public static void Start() {
    var t = new Thread(() => {
      var until = DateTime.UtcNow.AddSeconds(10);
      while (DateTime.UtcNow < until) {
        var h = FindWindow("Credential Dialog Xaml Host", null);
        if (h != IntPtr.Zero) { SetForegroundWindow(h); return; }
        Thread.Sleep(50);
      }
    });
    t.IsBackground = true;
    t.Start();
  }
}
"@
    [KAPEVaultHelloFocus]::AllowSetForegroundWindow(-1) | Out-Null
    [KAPEVaultHelloFocus]::Start()
    } catch { }
  }

  function Sign-Challenge($credential) {
    $data = $BufferExt::AsBuffer([Convert]::FromBase64String($Challenge))
    $signed = Await ($credential.RequestSignAsync($data)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
    if ($signed.Status -ne 'Success') { return @{ status = [string]$signed.Status } }
    return @{ status = 'Success'; signature = [Convert]::ToBase64String($ToArray.Invoke($null, @($signed.Result))) }
  }

  switch ($Op) {
    'supported' {
      $ok = Await ($Manager::IsSupportedAsync()) ([bool])
      Write-Result @{ status = 'Success'; supported = [bool]$ok }
    }
    'create' {
      if (-not (Await ($Manager::IsSupportedAsync()) ([bool]))) { Write-Result @{ status = 'Unsupported' }; break }
      Start-FocusWatch
      $made = Await ($Manager::RequestCreateAsync($Name, [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
      if ($made.Status -ne 'Success') { Write-Result @{ status = [string]$made.Status }; break }
      Write-Result (Sign-Challenge $made.Credential)
    }
    'sign' {
      $opened = Await ($Manager::OpenAsync($Name)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
      if ($opened.Status -ne 'Success') { Write-Result @{ status = [string]$opened.Status }; break }
      Start-FocusWatch
      Write-Result (Sign-Challenge $opened.Credential)
    }
    'delete' {
      Await-Action ($Manager::DeleteAsync($Name))
      Write-Result @{ status = 'Success' }
    }
  }
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  Write-Result @{ status = 'Error'; message = [string]$e.Message }
}
