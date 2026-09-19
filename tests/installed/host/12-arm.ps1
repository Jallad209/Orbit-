# Scenario 12, before the restart: login launch is registered by the real Settings toggle, a
# bill is due a few minutes from now (so its reminder falls due after the machine is back),
# and both facts are recorded for the post-restart check.
. "$PSScriptRoot\_lib.ps1"
Require-Orbit 'the bill is added in the app'

$run = Get-RunValue
if (-not $run -or $run -notmatch '--background') {
  "login launch is not registered (Run\Orbit = '$run'). Settings -> Desktop -> turn ON 'Start Orbit at login', then run this again."
  exit 1
}
if ($run.IndexOf($Exe, [StringComparison]::OrdinalIgnoreCase) -lt 0) { "Run\Orbit names another executable: $run"; exit 1 }
"Run\Orbit = $run"

$days = Get-BillRuleDays
if ($days -notcontains 0) {
  "no bill reminder rule with Days 0 found (rules: $($days -join ', ')). Settings -> Rules -> Reminder, Days 0; then run this again."
  exit 1
}

$due = (Get-Date).AddMinutes(8)
$hhmm = $due.ToString('HH:mm')
''
"NOW in Orbit: Spending -> Add bill:  Title 'reboot test'   Amount 5   Due date today   Due time $hhmm   -> Add bill."
$null = Read-Host 'Press Enter here once the bill is added'
'looking for the queued reminder...'
$reminder = Wait-ArmedReminder 90
if (-not $reminder) { 'no pending reminder with a future fire time appeared within 90 s; check the due time and the Days-0 rule, then run this again'; exit 1 }
"queued: '$($reminder.title)' fires at $(Local([DateTimeOffset]$reminder.fireAt)) local"

Save-Evidence '12-armed.json' ([ordered]@{
  armedAt = Iso(Now-Utc)
  bootTimeBefore = Iso(Get-BootTime)
  runValue = $run
  reminder = Format-Reminder $reminder
})

''
'NEXT:'
'  1. Right-click the Orbit tray icon -> Quit, and wait until the icon is gone.'
'  2. Type:   shutdown /r /t 0'
'  3. After the restart sign in as OrbitTest, open PowerShell straight away (Start -> type powershell),'
'     and run next.ps1 again. It waits for the toast itself: do NOT click the toast when it appears.'
