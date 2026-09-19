# Last host step: uninstall Orbit from the disposable account and record what is left, so the
# account can be deleted from the developer account afterwards (see README.md).
. "$PSScriptRoot\_lib.ps1"
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Right-click the tray icon -> Quit first, then run this again.'; exit 1 }
$uninstaller = Join-Path $env:LOCALAPPDATA 'Orbit\uninstall.exe'
if (Test-Path $uninstaller) {
  Start-Process $uninstaller -ArgumentList '/S' -Wait
  Start-Sleep -Seconds 3
}
& (Join-Path $Harness 'checks.ps1') -Action uninstall-snapshot -EvidenceDir $Evidence | Out-Null
Move-Item (Join-Path $Evidence 'after-uninstall.json') (Join-Path $Evidence 'host-after-uninstall.json') -Force
$after = Read-Evidence 'host-after-uninstall.json'
"executable gone: $(-not $after.executableExists)   Run value gone: $(-not $after.autostartCommand)   orbit:// gone: $(-not $after.protocolCommand)"
''
'Done on this account. Sign out of OrbitTest (Start -> account picture -> Sign out), sign in as yourself,'
'and tell Claude; the account itself is deleted from your own admin PowerShell (README.md, "Afterwards").'
