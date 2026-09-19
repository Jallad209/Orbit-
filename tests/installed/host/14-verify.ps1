# Scenario 14, part two: the machine slept across the due time; after the resume exactly one
# delivery must follow, and the reminder must be fired once. Sleep and resume times come from
# the System event log, the delivery from the shell log, the row from the database.
. "$PSScriptRoot\_lib.ps1"
$armed = Read-Evidence '14-armed.json'
$armedAt = [DateTimeOffset]$armed.armedAt
$fireAt = [DateTimeOffset]$armed.reminder.fireAt
"armed $(Local $armedAt) local, reminder due $(Local $fireAt)"

# The wake the user just came back from is the last resume since arming; the sleep that
# matters is the last one before it. Modern Standby can log short in/out pairs of its own
# (a screen-off, a maintenance wake); every event is kept in the evidence.
$power = @(Get-PowerEvents $armedAt)
$isSleep = { $_.provider -eq 'Microsoft-Windows-Kernel-Power' -and ($_.id -eq 42 -or $_.id -eq 506) }
$isResume = { ($_.provider -eq 'Microsoft-Windows-Kernel-Power' -and ($_.id -eq 107 -or $_.id -eq 507)) -or $_.provider -eq 'Microsoft-Windows-Power-Troubleshooter' }
$resume = $power | Where-Object $isResume | Select-Object -Last 1
$sleep = $power | Where-Object $isSleep | Where-Object { -not $resume -or ([DateTimeOffset]$_.at) -lt ([DateTimeOffset]$resume.at) } | Select-Object -Last 1
$sleptAt = if ($sleep) { [DateTimeOffset]$sleep.at } else { $null }
$resumedAt = if ($resume) { [DateTimeOffset]$resume.at } else { $null }
"sleep: $(if ($sleptAt) { Local $sleptAt } else { 'not recorded' })   resume: $(if ($resumedAt) { Local $resumedAt } else { 'not recorded' })"
if (-not $sleptAt -or -not $resumedAt) {
  'Windows recorded no sleep/resume pair since arming. If the machine did sleep, tell Claude; otherwise run the arm step again.'
  Save-Evidence '14-after-resume.json' ([ordered]@{ at = Iso(Now-Utc); armedAt = $armed.armedAt; powerEvents = $power; verdict = 'NOT PROVED: no sleep/resume recorded' })
  exit 1
}

$deadline = $fireAt.AddMinutes(3)
if ($deadline -lt (Now-Utc).AddMinutes(2)) { $deadline = (Now-Utc).AddMinutes(2) }
$delivered = @(Wait-Delivery $armedAt $deadline '14-toast.png')
$deliveredAt = if ($delivered.Count) { [DateTimeOffset]$delivered[0].ts } else { $null }
$reminderNow = Get-Reminder $armed.reminder.id
"deliveries since arming: $($delivered.Count) (fired $(Sum-Fired $delivered)) $(if ($deliveredAt) { 'at ' + (Local $deliveredAt) })  reminder status now: $($reminderNow.status)"
Save-NotificationCentre '14-notification-centre.png' | Out-Null
Copy-ShellLog '14-shell.log' | Out-Null

$sleptAcrossDueTime = $sleptAt -lt $fireAt -and $resumedAt -ge $fireAt
$landed = if (-not $deliveredAt) { 'never' } elseif ($deliveredAt -lt $sleptAt) { 'before sleep' } elseif ($deliveredAt -lt $resumedAt.AddSeconds(-5)) { 'during sleep' } else { 'after resume' }
$once = $delivered.Count -eq 1 -and (Sum-Fired $delivered) -eq 1 -and $reminderNow.status -eq 'fired'
$pass = $sleptAcrossDueTime -and $once -and $landed -eq 'after resume'
Save-Evidence '14-after-resume.json' ([ordered]@{
  at = Iso(Now-Utc)
  armedAt = $armed.armedAt
  reminderFireAt = $armed.reminder.fireAt
  sleptAt = Iso($sleptAt)
  resumedAt = Iso($resumedAt)
  sleptAcrossDueTime = $sleptAcrossDueTime
  powerEvents = $power
  deliveredAt = if ($deliveredAt) { Iso($deliveredAt) } else { $null }
  deliveryLanded = $landed
  deliveriesSinceArming = $delivered.Count
  firedSinceArming = Sum-Fired $delivered
  reminderAfter = Format-Reminder $reminderNow
  orbitProcesses = @(Get-OrbitProcesses)
  pass = $pass
})
$why = "slept $(Local $sleptAt) to $(Local $resumedAt) $(if ($sleptAcrossDueTime) { 'across' } else { 'NOT across' }) the due time $(Local $fireAt); delivered $landed, fired $(Sum-Fired $delivered) in $($delivered.Count) event(s), row $($reminderNow.status)"
Verdict '14' $pass $why
if (-not $sleptAcrossDueTime) { 'The machine was not asleep at the due time, so nothing was proved; run the arm step again (next.ps1 -Step 14) and wait longer before waking it.' }
''
'NEXT: run next.ps1 again to uninstall and finish.'
