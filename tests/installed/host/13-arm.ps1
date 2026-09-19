# Scenario 13, before the restart: login launch is switched off by the real Settings toggle,
# which must remove the Run value; the post-restart check then expects no Orbit at all.
. "$PSScriptRoot\_lib.ps1"
Require-Orbit 'the toggle is in Settings -> Desktop'

if (Get-RunValue) {
  ''
  'NOW in Orbit: Settings -> Desktop -> turn OFF "Start Orbit at login". It must say "Off."'
  $null = Read-Host 'Press Enter here once it is off'
}
$until = (Now-Utc).AddSeconds(20)
while ((Get-RunValue) -and (Now-Utc) -lt $until) { Start-Sleep -Seconds 1 }
$run = Get-RunValue
if ($run) { "Run\Orbit is still '$run'; the toggle did not remove it. Tell Claude."; exit 1 }
'Run\Orbit: absent'

Save-Evidence '13-armed.json' ([ordered]@{
  armedAt = Iso(Now-Utc)
  bootTimeBefore = Iso(Get-BootTime)
  runValue = $null
  orbitProcesses = @(Get-OrbitProcesses)
})

''
'NEXT:'
'  1. Right-click the Orbit tray icon -> Quit, and wait until the icon is gone.'
'  2. Type:   shutdown /r /t 0'
'  3. After the restart sign in as OrbitTest, open PowerShell, and run next.ps1 again'
'     (it waits until a minute after logon before it looks).'
