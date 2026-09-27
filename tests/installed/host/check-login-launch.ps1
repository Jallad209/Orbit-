# Read login launch from the real account and save it as evidence: the Run value, Windows'
# own enabled/disabled flag for it (Task Manager > Startup apps), and Orbit's preference.
# Run this in your own PowerShell. A shell started by an app that Windows packages (Claude's
# desktop app is one) can see a virtualised copy of HKCU and AppData instead of the real ones,
# which is how a login launch that plainly happened once read back as "not registered".
. "$PSScriptRoot\_lib.ps1"
$null = Use-PassAccount

$run = Get-RunValue
$approved = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' -Name Orbit -ErrorAction SilentlyContinue).Orbit
# StartupApproved's first byte is even (02) when the entry is enabled, odd (03) when the user
# switched it off in Task Manager; absent means Windows has not recorded a choice.
$enabled = if ($null -eq $approved) { $null } else { ($approved[0] % 2) -eq 0 }
$prefsPath = Join-Path $env:APPDATA 'app.orbit.desktop\desktop-preferences.json'
$prefs = if (Test-Path $prefsPath) { Get-Content -LiteralPath $prefsPath -Raw | ConvertFrom-Json } else { $null }

$name = "login-launch-$((Now-Utc).ToString('yyyyMMdd-HHmmss')).json"
Save-Evidence $name ([ordered]@{
  at = Iso(Now-Utc)
  account = $env:USERNAME
  runValue = $run
  startupApprovedEnabled = $enabled
  prefsAutostart = if ($prefs) { $prefs.autostart } else { $null }
  prefsWritten = if (Test-Path $prefsPath) { Iso([DateTimeOffset](Get-Item $prefsPath).LastWriteTime) } else { $null }
  orbitProcesses = @(Get-OrbitProcesses)
}) | Out-Null

''
"Run\Orbit:                $(if ($run) { $run } else { 'ABSENT' })"
"Enabled in Startup apps:  $(if ($null -eq $enabled) { 'no choice recorded' } else { $enabled })"
"Orbit preference:         autostart = $(if ($prefs) { $prefs.autostart } else { 'no preferences file' })"
"Orbit running:            $(@(Get-OrbitProcesses).Count) process(es), window shown: $((@(Get-OrbitProcesses) | ForEach-Object { $_.visibleWindow }) -join ',')"
''
"Saved as evidence\$name. Tell Claude it is done."
