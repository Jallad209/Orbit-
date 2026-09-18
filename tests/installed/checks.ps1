param(
  [ValidateSet('snapshot', 'foreign-handler', 'protocol', 'uninstall-snapshot')]
  [string]$Action = 'snapshot',
  [string]$EvidenceDir = 'C:\OrbitHarness\evidence',
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
# Tauri's NSIS bundle with installMode "currentUser" installs to %LOCALAPPDATA%\<productName>
# (not Programs\), and the binary keeps its crate name, orbit.exe.
$installRoot = Join-Path $env:LOCALAPPDATA 'Orbit'
$exe = Join-Path $installRoot 'orbit.exe'
$uninstaller = Join-Path $installRoot 'uninstall.exe'

if ($Action -eq 'protocol') {
  if (-not $ExpectedRecordUri.StartsWith('orbit://')) { throw 'Pass -ExpectedRecordUri orbit://kind/uuid.' }
  # A protocol launch while Orbit runs starts a second orbit.exe that hands the link to the
  # running instance and exits, so the count right after Start-Process is always 2. What the
  # scenario needs is the settled state: the original process (and only it) still there.
  $before = @(Get-Process Orbit -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  Start-Process $ExpectedRecordUri
  $immediate = @(Get-Process Orbit -ErrorAction SilentlyContinue).Count
  $started = Get-Date
  do {
    Start-Sleep -Milliseconds 250
    $now = @(Get-Process Orbit -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    $settled = $now.Count -eq 1 -and (-not $before -or ($before -contains $now[0]))
  } until ($settled -or ((Get-Date) - $started).TotalSeconds -ge 15)
  Save-Evidence 'protocol-dispatch.json' ([ordered]@{
    at = [DateTimeOffset]::UtcNow.ToString('O')
    uriKind = ([uri]$ExpectedRecordUri).Host
    processesBefore = $before
    processCountImmediately = $immediate
    processesAfter = $now
    settledWithinMs = [int]((Get-Date) - $started).TotalMilliseconds
    originalProcessSurvived = (-not $before) -or ($before | Where-Object { $now -contains $_ }).Count -eq $before.Count
    exactlyOneProcess = $now.Count -eq 1
  })
  if ($now.Count -ne 1) { Write-Warning "$($now.Count) Orbit processes 15 s after the launch" }
  exit 0
}

$snapshot = [ordered]@{
  at = [DateTimeOffset]::UtcNow.ToString('O')
  action = $Action
  executableExists = Test-Path -LiteralPath $exe
  uninstallerExists = Test-Path -LiteralPath $uninstaller
  executableSha256 = if (Test-Path -LiteralPath $exe) { (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash } else { $null }
  protocolCommand = $command
  protocolOwnsOrbit = $command -and ($command.IndexOf($exe, [StringComparison]::OrdinalIgnoreCase) -ge 0) -and $command.EndsWith('"%1"')
  autostartCommand = $run
  orbitProcesses = @(Get-Process Orbit -ErrorAction SilentlyContinue | Select-Object Id, StartTime, Path)
  dataDirectoryExists = Test-Path -LiteralPath (Join-Path $env:APPDATA 'app.orbit.desktop\data')
}

$name = if ($Action -eq 'uninstall-snapshot') { 'after-uninstall.json' } else { 'installed-state.json' }
Save-Evidence $name $snapshot

if ($Action -eq 'snapshot' -and (-not $snapshot.executableExists -or -not $snapshot.protocolOwnsOrbit)) {
  throw 'Installed-state validation failed. Inspect the JSON evidence before continuing.'
}
