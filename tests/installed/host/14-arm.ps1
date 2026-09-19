# Scenario 14, part one: a bill falls due a few minutes from now, then the machine is put to
# sleep so the due time passes while nothing can run. Windows records the sleep and the resume
# in the System log; the second part reads them back and waits for the single delivery.
. "$PSScriptRoot\_lib.ps1"
Require-Orbit 'the bill is added in the app'
$days = Get-BillRuleDays
if ($days -notcontains 0) { "no bill reminder rule with Days 0 found (rules: $($days -join ', ')). Settings -> Rules -> Reminder, Days 0; then run this again."; exit 1 }

$due = (Get-Date).AddMinutes(5)
$hhmm = $due.ToString('HH:mm')
''
"NOW in Orbit: Spending -> Add bill:  Title 'sleep test'   Amount 5   Due date today   Due time $hhmm   -> Add bill."
$null = Read-Host 'Press Enter here once the bill is added'
'looking for the queued reminder...'
$reminder = Wait-ArmedReminder 90
if (-not $reminder) { 'no pending reminder with a future fire time appeared within 90 s; check the due time and the Days-0 rule, then run this again'; exit 1 }
$fireAt = [DateTimeOffset]$reminder.fireAt
$wakeAfter = $fireAt.AddSeconds(90)
"queued: '$($reminder.title)' fires at $(Local $fireAt) local"

$deliveredBefore = @(Log-Events ((Now-Utc).AddMinutes(-30)) 'scheduler' 'deliver')
Save-Evidence '14-armed.json' ([ordered]@{
  armedAt = Iso(Now-Utc)
  reminder = Format-Reminder $reminder
  wakeNotBefore = Iso($wakeAfter)
  deliveriesLoggedBeforeSleep = $deliveredBefore.Count
  orbitProcesses = @(Get-OrbitProcesses)
})

''
'The machine goes to SLEEP in 20 seconds. Keep it plugged in and do not close the lid.'
"Leave it asleep until at least $(Local $wakeAfter) (local time), then press a key or the power button,"
'sign in as OrbitTest, and run next.ps1 straight away.'
Start-Sleep -Seconds 20
[System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false) | Out-Null
Start-Sleep -Seconds 30
''
"Back at $(Local(Now-Utc)). Run next.ps1 now."
