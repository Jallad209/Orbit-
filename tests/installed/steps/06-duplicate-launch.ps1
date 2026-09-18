# Scenario 6: launching Orbit again while it runs must activate the existing instance and
# leave exactly one process.
$exe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe'
$before = @(Get-Process Orbit -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($before.Count -ne 1) { "expected exactly one running Orbit process, found $($before.Count)"; exit 1 }
Start-Process $exe
$immediate = @(Get-Process Orbit -ErrorAction SilentlyContinue).Count
$started = Get-Date
do {
  Start-Sleep -Milliseconds 250
  $now = @(Get-Process Orbit -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
} until (($now.Count -eq 1 -and $now[0] -eq $before[0]) -or ((Get-Date) - $started).TotalSeconds -ge 15)
$result = [ordered]@{
  at = [DateTimeOffset]::UtcNow.ToString('O')
  processesBefore = $before
  processCountImmediately = $immediate
  processesAfter = $now
  settledWithinMs = [int]((Get-Date) - $started).TotalMilliseconds
  originalProcessSurvived = $now -contains $before[0]
  exactlyOneProcess = $now.Count -eq 1
}
$result | ConvertTo-Json | Set-Content 'C:\OrbitHarness\evidence\06-duplicate-launch.json' -Encoding utf8
$result | ConvertTo-Json

"`nNEXT (scenario 7): run:`n  C:\OrbitHarness\steps\07-forced-termination.ps1"
