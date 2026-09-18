param(
  [ValidateSet('snapshot', 'foreign-handler', 'protocol', 'uninstall-snapshot')]
  [string]$Action = 'snapshot',
  [string]$EvidenceDir = 'C:\OrbitEvidence',
  [string]$ExpectedRecordUri = ''
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null

function Save-Evidence([string]$Name, [object]$Value) {
  $path = Join-Path $EvidenceDir $Name
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding utf8
  Write-Output $path
}

if ($Action -eq 'foreign-handler') {
  $key = 'HKCU:\Software\Classes\orbit'
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
  Set-Item -Path "$key\shell\open\command" -Value '"C:\Windows\System32\notepad.exe" "%1"'
  Save-Evidence 'foreign-handler-before-install.json' ([ordered]@{
    command = (Get-Item "$key\shell\open\command").GetValue('')
  })
  exit 0
}

$protocolKey = 'HKCU:\Software\Classes\orbit'
$commandKey = "$protocolKey\shell\open\command"
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$command = if (Test-Path $commandKey) { (Get-Item $commandKey).GetValue('') } else { $null }
$run = if (Test-Path $runKey) { (Get-ItemProperty -Path $runKey -Name Orbit -ErrorAction SilentlyContinue).Orbit } else { $null }
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Orbit'
$exe = Join-Path $installRoot 'Orbit.exe'
$uninstaller = Join-Path $installRoot 'uninstall.exe'

if ($Action -eq 'protocol') {
  if (-not $ExpectedRecordUri.StartsWith('orbit://')) { throw 'Pass -ExpectedRecordUri orbit://kind/uuid.' }
  Start-Process $ExpectedRecordUri
  Save-Evidence 'protocol-dispatch.json' ([ordered]@{
    at = [DateTimeOffset]::UtcNow.ToString('O')
    uriKind = ([uri]$ExpectedRecordUri).Host
    processCount = @(Get-Process Orbit -ErrorAction SilentlyContinue).Count
  })
  exit 0
}

$snapshot = [ordered]@{
  at = [DateTimeOffset]::UtcNow.ToString('O')
  action = $Action
  executableExists = Test-Path -LiteralPath $exe
  uninstallerExists = Test-Path -LiteralPath $uninstaller
  executableSha256 = if (Test-Path -LiteralPath $exe) { (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash } else { $null }
  protocolCommand = $command
  protocolOwnsOrbit = $command -and $command.Contains($exe) -and $command.EndsWith('"%1"')
  autostartCommand = $run
  orbitProcesses = @(Get-Process Orbit -ErrorAction SilentlyContinue | Select-Object Id, StartTime, Path)
  dataDirectoryExists = Test-Path -LiteralPath (Join-Path $env:APPDATA 'app.orbit.desktop\data')
}

$name = if ($Action -eq 'uninstall-snapshot') { 'after-uninstall.json' } else { 'installed-state.json' }
Save-Evidence $name $snapshot

if ($Action -eq 'snapshot' -and (-not $snapshot.executableExists -or -not $snapshot.protocolOwnsOrbit)) {
  throw 'Installed-state validation failed. Inspect the JSON evidence before continuing.'
}
