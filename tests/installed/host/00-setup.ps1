# Host-account setup: install the candidate for this Windows user, record what was installed,
# and start Orbit for its first run. Run it signed in as the disposable account, never as the
# developer account (the NSIS currentUser install and the HKCU keys would land in that profile).
. "$PSScriptRoot\_lib.ps1"

if ($env:USERNAME -ne 'OrbitTest') {
  "You are signed in as '$env:USERNAME', not OrbitTest. Sign in as the disposable account first."
  exit 1
}

$bundle = Join-Path $Repo 'apps\orbit\src-tauri\target\release\bundle\nsis'
$installer = Get-ChildItem -LiteralPath $bundle -Filter 'Orbit_*_x64-setup.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $installer) { "no Orbit_*_x64-setup.exe under $bundle; build the candidate from the developer account first"; exit 1 }

$hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
"installing $($installer.Name) (SHA-256 $hash)"
Save-Evidence 'host-candidate.json' ([ordered]@{
  at = Iso(Now-Utc)
  account = $env:USERNAME
  computer = $env:COMPUTERNAME
  os = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber)
  installer = $installer.Name
  sha256 = $hash
})
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait

& (Join-Path $Harness 'checks.ps1') -Action snapshot -EvidenceDir $Evidence | Out-Null
Move-Item (Join-Path $Evidence 'installed-state.json') (Join-Path $Evidence 'host-installed-state.json') -Force
$state = Read-Evidence 'host-installed-state.json'
"executable: $($state.executableExists)   orbit:// owned: $($state.protocolOwnsOrbit)   Run value: $($state.autostartCommand)"
if (-not $state.executableExists) { 'the install did not produce orbit.exe'; exit 1 }

Start-Process $Exe
''
'Orbit is starting for its first run. In Orbit:'
'  1. Finish the first-run screen (defaults are fine).'
'  2. Settings -> Rules -> "Reminder": Remind me "when a bill is due within", Days 0 -> save.'
'     (Days 0 makes a bill remind at its own due time; that is how the next steps pick the minute.)'
'  3. Settings -> Desktop -> turn ON "Start Orbit at login". It must say "Registered for this Windows user".'
