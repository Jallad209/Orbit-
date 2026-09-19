# The installed pass, one command at a time. Run it, do what it says, run it again.
#
#   C:\OrbitHarness\next.ps1            run the next step
#   C:\OrbitHarness\next.ps1 -Redo      run the current step again
#   C:\OrbitHarness\next.ps1 -Skip      skip the current step (records NOT RUN)
#   C:\OrbitHarness\next.ps1 -Reset     start over from the first step
param([switch] $Redo, [switch] $Skip, [switch] $Reset)
$ErrorActionPreference = 'Continue'
$steps = 'C:\OrbitHarness\steps'
$evidence = 'C:\OrbitHarness\evidence'
$progress = Join-Path $evidence 'progress.json'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null

function TaskId {
  $file = Join-Path $evidence 'task-id.txt'
  if (Test-Path $file) { return (Get-Content $file | Select-Object -First 1).Trim() }
  $title = Read-Host 'Title of a task you created in Orbit (for example test1)'
  & (Join-Path $steps 'find-task.ps1') $title | Out-Null
  if (Test-Path $file) { return (Get-Content $file | Select-Object -First 1).Trim() }
  throw "no task titled '$title' found; create one in Orbit first"
}

$plan = @(
  @{ n = '3';  name = 'orbit:// link opens the task while Orbit is visible';   before = 'Have Orbit OPEN and visible.';                        run = { & "$steps\03-protocol-opens-task.ps1" (TaskId) } },
  @{ n = '4';  name = 'orbit:// link restores the hidden window';             before = 'Close Orbit''s window with the X (it hides to the tray). Do not Quit.'; run = { & "$steps\04-hidden-activation.ps1" (TaskId) } },
  @{ n = '5';  name = 'orbit:// link cold-starts exactly one process';        before = 'Right-click the tray icon and choose Quit.';           run = { & "$steps\05-cold-activation.ps1" (TaskId) } },
  @{ n = '6';  name = 'duplicate manual launch activates the running instance'; before = 'Leave Orbit running.';                             run = { & "$steps\06-duplicate-launch.ps1" } },
  @{ n = '7';  name = 'forced termination reports one unclean run';           before = 'Nothing to do first.';                               run = { & "$steps\07-forced-termination.ps1" } },
  @{ n = '7b'; name = 'read the unclean-run note';                            before = 'In Orbit open Settings -> Data and note the wording about the previous run; tell Claude.'; run = { 'Tell Claude what Settings -> Data says about the previous run.' } },
  @{ n = '8';  name = 'A -> B upgrade keeps data and registrations';          before = 'Quit Orbit from the tray.';                          run = { & "$steps\08-upgrade.ps1" } },
  @{ n = '8b'; name = 'confirm data survived the upgrade';                    before = 'Launch Orbit: is test1 still there? Is Settings -> Desktop unchanged? Tell Claude.'; run = { 'Tell Claude whether test1 and your settings survived.' } },
  @{ n = '8c'; name = 'register login launch for the uninstall check';       before = 'Nothing to do first.';                               run = { & "$steps\08c-enable-login-launch.ps1" } },
  @{ n = '9';  name = 'uninstall keeps data, removes only Orbit''s own keys';  before = 'Quit Orbit from the tray.';                          run = { & "$steps\09-uninstall.ps1" } },
  @{ n = '10'; name = 'reinstall for the notification scenario';              before = 'Nothing to do first.';                               run = { & "$steps\O3.ps1" } },
  @{ n = '11'; name = 'an installed notification carries the Orbit name and icon'; before = 'The one human step left. Launch Orbit, open Spending, add a bill due today, and give it a reminder a couple of minutes from now. When the Windows toast appears: Win+Shift+S, snip it, save as C:\OrbitHarness\evidence\11-toast.png. Then Win+N for the notification centre and snip that as 11-centre.png. Tell Claude the file names.'; run = { 'Tell Claude the two snip file names.' } }
)

$state = if ((Test-Path $progress) -and -not $Reset) { Get-Content $progress | ConvertFrom-Json } else { [pscustomobject]@{ index = 0; results = @() } }
$i = [int]$state.index
if ($Redo -and $i -gt 0) { $i-- }
if ($i -ge $plan.Count) { 'All steps done. Close the Sandbox only after the evidence folder has everything you want to keep.'; exit 0 }
$step = $plan[$i]

if ($Skip) {
  $state.results += "$($step.n): NOT RUN (skipped)"
} else {
  ''
  "=== Scenario $($step.n): $($step.name) ==="
  "FIRST: $($step.before)"
  $null = Read-Host 'Press Enter when that is done'
  ''
  & $step.run
  $state.results += "$($step.n): ran $([DateTimeOffset]::UtcNow.ToString('HH:mm:ss'))Z"
}
$state.index = $i + 1
$state | ConvertTo-Json | Set-Content $progress -Encoding utf8

''
if ($state.index -lt $plan.Count) {
  $next = $plan[$state.index]
  "NEXT (scenario $($next.n)): $($next.before)"
  'Then run:  C:\OrbitHarness\next.ps1     (or press Up then Enter)'
} else {
  'That was the last Sandbox scenario. Tell Claude, then close the Sandbox.'
}
