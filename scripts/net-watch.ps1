param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ProcessId,

  [ValidateRange(1, 3600)]
  [int]$DurationSeconds = 30
)

$ErrorActionPreference = 'Stop'
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($DurationSeconds)
$observed = [System.Collections.Generic.List[object]]::new()
$udp = [System.Collections.Generic.List[object]]::new()

while ([DateTimeOffset]::UtcNow -lt $deadline) {
  $processes = @(Get-CimInstance Win32_Process)
  $ids = [System.Collections.Generic.HashSet[uint32]]::new()
  [void]$ids.Add([uint32]$ProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $processes) {
      if ($ids.Contains([uint32]$process.ParentProcessId) -and $ids.Add([uint32]$process.ProcessId)) {
        $changed = $true
      }
    }
  }
  if (-not ($processes.ProcessId -contains $ProcessId)) {
    throw "Process $ProcessId is no longer running."
  }
  foreach ($connection in Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue) {
    if ($ids -contains $connection.OwningProcess) {
      $observed.Add([pscustomobject]@{
        ProcessId = $connection.OwningProcess
        Local = "$($connection.LocalAddress):$($connection.LocalPort)"
        Remote = "$($connection.RemoteAddress):$($connection.RemotePort)"
      })
    }
  }
  foreach ($endpoint in Get-NetUDPEndpoint -ErrorAction SilentlyContinue) {
    if ($ids -contains $endpoint.OwningProcess) {
      $udp.Add([pscustomobject]@{
        ProcessId = $endpoint.OwningProcess
        Local = "$($endpoint.LocalAddress):$($endpoint.LocalPort)"
      })
    }
  }
  Start-Sleep -Milliseconds 250
}

if ($observed.Count -gt 0) {
  $observed | Sort-Object ProcessId, Remote -Unique | Format-Table -AutoSize
  throw "Orbit made an established TCP connection during the observation window."
}

if ($udp.Count -gt 0) {
  Write-Output 'UDP endpoints observed (connectionless; review their owning process separately):'
  $udp | Sort-Object ProcessId, Local -Unique | Format-Table -AutoSize
}

Write-Output "PASS: no established TCP connections observed for Orbit process $ProcessId or its descendant process tree."
