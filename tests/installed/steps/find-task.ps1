# Print the id of a task by title, read from the installed Orbit database (its JSON rows, and
# the write-ahead log where a fresh record still lives). Usage: find-task.ps1 test1
param([Parameter(Mandatory = $true)][string] $Title)
$dir = Join-Path $env:APPDATA 'app.orbit.desktop\data'
$text = ''
foreach ($name in 'orbit.db', 'orbit.db-wal') {
  $path = Join-Path $dir $name
  if (-not (Test-Path $path)) { continue }
  # Orbit keeps the file open; read it with shared access.
  $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::GetEncoding(28591))
    $text += $reader.ReadToEnd()
  } finally { $stream.Close() }
}
$escaped = [regex]::Escape($Title)
$hits = [regex]::Matches($text, '(?i)"id":"([0-9a-f-]{36})"[^{}]*?"title":"' + $escaped + '"') |
  ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if (-not $hits) { "no task titled '$Title' found in $dir"; exit 1 }
"task '$Title':"
$hits
"next: C:\OrbitHarness\steps\03-protocol-opens-task.ps1 $($hits | Select-Object -Last 1)"
