# Scenario 3: an orbit:// link opens the exact task in the running Orbit, one process.
# Usage: 03-protocol-opens-task.ps1 <task uuid from the task's URL, /tasks/<uuid>>
param([Parameter(Mandatory = $true)][string] $TaskId)
& 'C:\OrbitHarness\checks.ps1' -Action protocol -ExpectedRecordUri "orbit://task/$TaskId"
Get-Content 'C:\OrbitHarness\evidence\protocol-dispatch.json'

"`nNEXT (scenario 4): close Orbit's window with the X (it hides to the tray), then run:`n  C:\OrbitHarness\steps\04-hidden-activation.ps1 01a0b6cd-89c2-719a-811a-2bd6bc244294"
