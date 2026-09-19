# Scenario 13, after the restart: no Run value, no Orbit process, no launch in the shell log.
. "$PSScriptRoot\_lib.ps1"
$armed = Read-Evidence '13-armed.json'
$armedAt = [DateTimeOffset]$armed.armedAt
$boot = Get-BootTime
if ($boot -le $armedAt) { "the machine has not restarted since arming ($(Local $armedAt)); restart it, then run this again"; exit 1 }
$logon = Get-LogonTime
"booted $(Local $boot) local, signed in $(Local $logon), armed $(Local $armedAt)"

# Give a login launch every chance to show up before concluding it did not happen.
$wait = [int](60 - ((Now-Utc) - $logon).TotalSeconds)
if ($wait -gt 0) { "waiting $wait s (a minute after logon)..."; Start-Sleep -Seconds $wait }

$run = Get-RunValue
$procs = @(Get-OrbitProcesses)
$launches = @(Log-Events $boot 'resident' 'launch')
"Run\Orbit = $(if ($run) { $run } else { 'absent' });  Orbit processes: $($procs.Count);  launches logged after boot: $($launches.Count)"
Copy-ShellLog '13-shell.log' | Out-Null

$pass = (-not $run) -and $procs.Count -eq 0 -and $launches.Count -eq 0
Save-Evidence '13-after-reboot.json' ([ordered]@{
  at = Iso(Now-Utc)
  armedAt = $armed.armedAt
  bootTime = Iso($boot)
  logonTime = Iso($logon)
  secondsAfterLogon = [int]((Now-Utc) - $logon).TotalSeconds
  runValue = $run
  orbitProcesses = $procs
  launchesAfterBoot = $launches.Count
  pass = $pass
})
Verdict '13' $pass "Run value $(if ($run) { 'present' } else { 'absent' }), $($procs.Count) process(es), $($launches.Count) launch(es) logged"
''
'NEXT: start Orbit from the Start menu, then run next.ps1 again for scenario 14 (it puts the machine to sleep).'
