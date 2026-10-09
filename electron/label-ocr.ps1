# Offline text reading for "Scan a label" (Windows PowerShell 5.1, WinRT Windows.Media.Ocr).
# Node runs this through -EncodedCommand (the file sits inside app.asar in the installed app) and
# writes the photo to stdin as base64, so the image never touches the disk. Prints exactly ONE JSON line.
# The script cannot ride stdin itself here: the photo does, and keeping the photo out of the script
# text keeps it out of PowerShell's script-block log.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Constrained Language Mode blocks the .NET calls below: no OCR here, and the form lets the user type.
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { Write-Output '{"status":"Unavailable"}'; return }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Result($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)) }

try {
  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$t) { $task = $asTaskOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }

  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null

  # No OCR language installed for the user's languages = no engine. Say so; the form lets them type.
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { Write-Result @{ status = 'Unavailable' }; return }

  $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream((New-Object System.IO.MemoryStream(, $bytes)))
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  Write-Result @{ status = 'Success'; lines = @($result.Lines | ForEach-Object { $_.Text }) }
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  Write-Result @{ status = 'Error'; message = [string]$e.Message }
}
