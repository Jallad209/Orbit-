# Scenario 12, after the restart: Orbit must have started by itself, hidden, and delivered
# the reminder armed before the restart. Waits for the delivery and captures the toast.
. "$PSScriptRoot\_lib.ps1"
$armed = Read-Evidence '12-armed.json'
$armedAt = [DateTimeOffset]$armed.armedAt
$boot = Get-BootTime
if ($boot -le $armedAt) { "the machine has not restarted since arming ($(Local $armedAt)); restart it, then run this again"; exit 1 }
"booted $(Local $boot) local, armed $(Local $armedAt); reminder due $(Local([DateTimeOffset]$armed.reminder.fireAt))"

$run = Get-RunValue
"Run\Orbit = $run"

# Windows may hold Run-key programs back for a few seconds after logon.
$until = (Now-Utc).AddSeconds(45)
do {
  $procs = @(Get-OrbitProcesses)
  if ($procs.Count -gt 0) { break }
  Start-Sleep -Seconds 2
} until ((Now-Utc) -gt $until)
$procsAtCheck = $procs
"Orbit processes: $($procs.Count)  visible window: $(($procs | ForEach-Object { $_.visibleWindow }) -join ',')"

$launches = @(Log-Events $boot 'resident' 'launch')
$ready = @(Log-Events $boot 'resident' 'ready')
$readyTimeout = @(Log-Events $boot 'resident' 'ready-timeout')
$launchMode = if ($launches.Count) { $launches[0].fields.launch } else { $null }
"first launch after boot: $launchMode at $(if ($launches.Count) { Local([DateTimeOffset]$launches[0].ts) } else { 'never' });  ready: $(if ($ready.Count) { Local([DateTimeOffset]$ready[0].ts) } else { 'never' })"

$fireAt = [DateTimeOffset]$armed.reminder.fireAt
$deadline = $fireAt.AddMinutes(3)
if ($deadline -lt (Now-Utc).AddMinutes(2)) { $deadline = (Now-Utc).AddMinutes(2) }
$delivered = @(Wait-Delivery $boot $deadline '12-toast.png')
$deliveredAt = if ($delivered.Count) { [DateTimeOffset]$delivered[0].ts } else { $null }
$reminderNow = Get-Reminder $armed.reminder.id
"deliveries after boot: $($delivered.Count) (fired $(Sum-Fired $delivered))  reminder status now: $($reminderNow.status)"
if ($delivered.Count -eq 0 -and $reminderNow.status -eq 'fired' -and ([DateTimeOffset]$reminderNow.updatedAt) -lt $boot) {
  "the reminder had already fired at $(Local([DateTimeOffset]$reminderNow.updatedAt)), before the restart: the quit-and-restart took longer than its due time. Run step 12 again (next.ps1 -Step 12)."
}
Save-NotificationCentre '12-notification-centre.png' | Out-Null
Copy-ShellLog '12-shell.log' | Out-Null

$startedHidden = ($launchMode -eq 'background') -and $readyTimeout.Count -eq 0 -and $procsAtCheck.Count -ge 1 -and -not ($procsAtCheck | Where-Object { $_.visibleWindow })
$deliveredOnce = $delivered.Count -ge 1 -and (Sum-Fired $delivered) -eq 1 -and $reminderNow.status -eq 'fired'
$readyAt = if ($ready.Count) { [DateTimeOffset]$ready[0].ts } else { $null }
Save-Evidence '12-after-reboot.json' ([ordered]@{
  at = Iso(Now-Utc)
  armedAt = $armed.armedAt
  bootTime = Iso($boot)
  logonTime = Iso(Get-LogonTime)
  runValue = $run
  orbitProcessesAtCheck = $procsAtCheck
  firstLaunchAfterBoot = if ($launches.Count) { [ordered]@{ at = $launches[0].ts; launch = $launchMode } } else { $null }
  readyAt = if ($readyAt) { Iso($readyAt) } else { $null }
  readyTimeoutLogged = $readyTimeout.Count -gt 0
  reminderFireAt = $armed.reminder.fireAt
  deliveredAt = if ($deliveredAt) { Iso($deliveredAt) } else { $null }
  deliveriesAfterBoot = $delivered.Count
  firedAfterBoot = Sum-Fired $delivered
  # Delivered by the hidden resident after it became ready; a catch-up when the due time had
  # already passed by then (a slow restart), still a delivery from the login-launched process.
  deliveredAfterReady = ($deliveredAt -and $readyAt) -and ($deliveredAt -ge $readyAt)
  catchUp = ($readyAt -ne $null) -and ($fireAt -lt $readyAt)
  reminderAfter = Format-Reminder $reminderNow
  startedHidden = $startedHidden
  deliveredOnce = $deliveredOnce
})

$why = "login launch $(if ($run) { 'registered' } else { 'MISSING' }); launch=$launchMode; visible window: $([bool]($procsAtCheck | Where-Object { $_.visibleWindow })); fired $(Sum-Fired $delivered) $(if ($deliveredAt) { 'at ' + (Local $deliveredAt) } else { '(never)' })"
Verdict '12' ([bool]$run -and $startedHidden -and $deliveredOnce) $why
''
'NEXT: run next.ps1 again for scenario 13 (leave Orbit as it is).'
