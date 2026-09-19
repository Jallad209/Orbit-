# Scenario 10: a notification the OS refuses must stay pending and be retried, not be
# marked fired. Windows' push-notification user service is stopped to make submission
# fail, a due reminder is created, the shell log is watched, then the service is restored
# and the retry must deliver.
$logs = Join-Path $env:APPDATA 'app.orbit.desktop\logs'
$exe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe'
function LogLines { Get-ChildItem $logs -Filter '*.log' | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content }
function Count($pattern) { @(LogLines | Select-String -SimpleMatch $pattern).Count }

if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -eq 0) { Start-Process $exe; Start-Sleep -Seconds 8 }
$svc = Get-Service -Name 'WpnUserService*' | Select-Object -First 1
"stopping $($svc.Name) (Windows push notifications for this user)"
Stop-Service -Name $svc.Name -Force
Start-Sleep -Seconds 2
"service status: $((Get-Service -Name $svc.Name).Status)"
$notifyBefore = Count '"op":"notify"'
$deliverBefore = Count '"op":"deliver"'

''
'NOW in Orbit: Inbox -> capture "Pay the water bill 5 tomorrow" -> Enter -> click it -> Enter to accept.'
$null = Read-Host 'Press Enter here once the bill is accepted'
'waiting 80 s for the scheduler tick while the service is down...'
Start-Sleep -Seconds 80
$notifyDown = (Count '"op":"notify"') - $notifyBefore
$deliverDown = (Count '"op":"deliver"') - $deliverBefore
"while down: notify errors logged = $notifyDown, deliveries logged = $deliverDown"
LogLines | Select-String -SimpleMatch '"scheduler"' | Select-Object -Last 3 | ForEach-Object { "  " + $_.Line.Substring(0, [Math]::Min(160, $_.Line.Length)) }

''
"starting $($svc.Name) again"
Start-Service -Name $svc.Name
'waiting 80 s for the retry...'
Start-Sleep -Seconds 80
$deliverUp = (Count '"op":"deliver"') - $deliverBefore - $deliverDown
"after restore: deliveries logged = $deliverUp"
LogLines | Select-String -SimpleMatch '"scheduler"' | Select-Object -Last 3 | ForEach-Object { "  " + $_.Line.Substring(0, [Math]::Min(160, $_.Line.Length)) }

''
if ($notifyDown -ge 1 -and $deliverDown -eq 0 -and $deliverUp -ge 1) { 'SCENARIO 10: PASS (refused while down, delivered on retry)' }
elseif ($notifyDown -eq 0 -and $deliverDown -ge 1) { 'SCENARIO 10: NOT PROVABLE this way (Windows accepted the toast even with the service stopped)' }
else { 'SCENARIO 10: FAIL or inconclusive (see counts above)' }
Copy-Item (Get-ChildItem $logs -Filter '*.log' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName 'C:\OrbitHarness\evidence\10-shell.log' -Force
