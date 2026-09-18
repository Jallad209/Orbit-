$ErrorActionPreference = 'Stop'

$installers = @(Get-ChildItem -LiteralPath 'C:\OrbitInstallers' -Filter '*setup.exe' -File | Sort-Object LastWriteTime)
if ($installers.Count -eq 0) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('No NSIS setup executable is mapped into C:\OrbitInstallers. Build the candidate from your own terminal, then reopen Sandbox.', 'Orbit verification') | Out-Null
  exit 1
}

$work = 'C:\OrbitCandidate'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$candidate = $installers[-1]
$localInstaller = Join-Path $work $candidate.Name
Copy-Item -LiteralPath $candidate.FullName -Destination $localInstaller -Force
$hash = (Get-FileHash -LiteralPath $localInstaller -Algorithm SHA256).Hash

$metadata = [ordered]@{
  capturedAt = [DateTimeOffset]::UtcNow.ToString('O')
  sandboxBuild = (Get-ComputerInfo -Property WindowsProductName, WindowsVersion, OsBuildNumber)
  installer = $candidate.Name
  sha256 = $hash
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath 'C:\OrbitEvidence\candidate.json' -Encoding utf8

Start-Process -FilePath $localInstaller -ArgumentList '/S' -Wait
Start-Process -FilePath 'notepad.exe' -ArgumentList 'C:\OrbitHarness\CHECKLIST.md'
Start-Process -FilePath 'explorer.exe' -ArgumentList 'C:\OrbitEvidence'
