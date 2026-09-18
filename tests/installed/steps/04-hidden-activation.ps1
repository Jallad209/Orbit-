# Scenario 4: with Orbit hidden in the tray (close its window first), an orbit:// link must
# restore the existing window on the exact record, still one process.
param([Parameter(Mandatory = $true)][string] $TaskId)
$before = @(Get-Process Orbit -ErrorAction SilentlyContinue)
if ($before.Count -ne 1) { "expected exactly one hidden Orbit process, found $($before.Count); close the window (not Quit) first"; exit 1 }
& 'C:\OrbitHarness\checks.ps1' -Action protocol -ExpectedRecordUri "orbit://task/$TaskId"
Copy-Item 'C:\OrbitHarness\evidence\protocol-dispatch.json' 'C:\OrbitHarness\evidence\04-hidden-activation.json' -Force
Get-Content 'C:\OrbitHarness\evidence\04-hidden-activation.json'

"`nNEXT (scenario 5): right-click the tray icon -> Quit, then run:`n  C:\OrbitHarness\steps\05-cold-activation.ps1 01a0b6cd-89c2-719a-811a-2bd6bc244294"
