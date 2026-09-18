# Diagnoses "could not attach over CDP" from the cold-launch harness.
# Launches the release binary exactly as coldLaunch.ts does (throwaway data
# folder, WebView2 profile, remote-debugging port), waits, then reports what
# the process and its WebView2 children actually look like in THIS session.
#
#   powershell -ExecutionPolicy Bypass -File tests\e2e\desktop\probe-launch.ps1
param(
  [string]$Exe = (Join-Path $PSScriptRoot "..\..\..\apps\orbit\src-tauri\target\release\orbit.exe"),
  [int]$Port = 9333,
  [int]$WaitSeconds = 8
)
$ErrorActionPreference = "Continue"
$Exe = [System.IO.Path]::GetFullPath($Exe)
if (-not (Test-Path $Exe)) { Write-Host "no binary at $Exe"; exit 1 }

$session = Join-Path $env:TEMP ("orbit-probe-" + [System.IO.Path]::GetRandomFileName().Replace(".", ""))
New-Item -ItemType Directory -Force (Join-Path $session "data") | Out-Null

Write-Host "=== session ==="
Write-Host ("elevated:   " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
Write-Host ("powershell: " + $PSVersionTable.PSVersion + " 64-bit=" + [Environment]::Is64BitProcess)
Write-Host ("exe:        " + $Exe)
Write-Host ("session:    " + $session)
Write-Host "env vars matching ORBIT|WEBVIEW2|PROXY|PLAYWRIGHT:"
Get-ChildItem env: | Where-Object { $_.Name -match 'ORBIT|WEBVIEW2|PROXY|PLAYWRIGHT' } | ForEach-Object { Write-Host ("  " + $_.Name + " = " + $_.Value) }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Exe
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.Environment["ORBIT_DATA_DIR"] = (Join-Path $session "data")
$psi.Environment["WEBVIEW2_USER_DATA_FOLDER"] = (Join-Path $session "webview")
$psi.Environment["ORBIT_AUTOSTART_FAKE"] = (Join-Path $session "autostart.txt")
$psi.Environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=$Port"

$p = [System.Diagnostics.Process]::Start($psi)
$out = $p.StandardOutput.ReadToEndAsync()
$err = $p.StandardError.ReadToEndAsync()
Start-Sleep -Seconds $WaitSeconds

Write-Host "=== process ==="
Write-Host ("pid $($p.Id) exited: " + $p.HasExited)
if (-not $p.HasExited) {
  $p.Refresh()
  Write-Host ("main window: '" + $p.MainWindowTitle + "' handle=" + $p.MainWindowHandle)
}

Write-Host "=== WebView2 children (browser process is the one with --embedded-browser-webview) ==="
$children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id }
$webviewRoot = $children | Where-Object { $_.Name -eq "msedgewebview2.exe" }
foreach ($c in $children) { Write-Host ("  [" + $c.ProcessId + "] " + $c.Name); Write-Host ("      " + $c.CommandLine) }
if (-not $webviewRoot) { Write-Host "  (no msedgewebview2.exe child)" }

Write-Host "=== flag check ==="
$cmd = ($webviewRoot | ForEach-Object { $_.CommandLine }) -join " "
Write-Host ("browser process has --remote-debugging-port: " + ($cmd -match 'remote-debugging-port'))

Write-Host "=== listeners owned by orbit / webview ==="
$pids = @($p.Id) + @($webviewRoot | ForEach-Object { $_.ProcessId })
$grand = Get-CimInstance Win32_Process | Where-Object { $pids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }
$pids += $grand
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess }
if ($listen) { $listen | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String | Write-Host } else { Write-Host "  (none)" }

Write-Host "=== CDP probe ==="
try {
  $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 3
  Write-Host ("OK: " + ($r.Content -replace '\s+', ' '))
} catch { Write-Host ("FAIL: " + $_.Exception.Message) }

if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -Confirm:$false }
Start-Sleep -Seconds 2
Write-Host "=== stdout ==="; Write-Host $out.Result
Write-Host "=== stderr ==="; Write-Host $err.Result
Write-Host "=== shell log ==="
Get-ChildItem (Join-Path $session "logs") -File -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName | ForEach-Object { Write-Host $_ } }
Remove-Item $session -Recurse -Force -ErrorAction SilentlyContinue
