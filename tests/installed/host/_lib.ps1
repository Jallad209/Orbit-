# Shared helpers for the host-account steps (scenarios 12-14). Dot-source it:
#   . "$PSScriptRoot\_lib.ps1"
# Paths come from the script's own location, so the harness works from wherever the
# repository is checked out; evidence lands in tests\installed\evidence like the Sandbox pass.
$ErrorActionPreference = 'Stop'
$script:Harness = Split-Path $PSScriptRoot -Parent
$script:Repo = Split-Path (Split-Path $Harness -Parent) -Parent
$script:Evidence = Join-Path $Harness 'evidence'
$script:Exe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe'
$script:DataDir = Join-Path $env:APPDATA 'app.orbit.desktop\data'
$script:LogDir = Join-Path $env:APPDATA 'app.orbit.desktop\logs'
$script:RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -ItemType Directory -Path $Evidence -Force | Out-Null

function Now-Utc { [DateTimeOffset]::UtcNow }
function Iso([DateTimeOffset] $t) { $t.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Local([DateTimeOffset] $t) { $t.ToLocalTime().ToString('HH:mm:ss') }

function Save-Evidence([string] $Name, [object] $Value) {
  $path = Join-Path $Evidence $Name
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding utf8
  "saved $path"
}
function Read-Evidence([string] $Name) {
  $path = Join-Path $Evidence $Name
  if (-not (Test-Path $path)) { throw "$Name is missing: run the arm step first" }
  Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

# The pass runs in one Windows account from start to finish. Orbit installs per user, so its
# Run value, its orbit:// key and its data folder all live in that account's profile, and
# evidence from two accounts would describe two different installs. The first step asks which
# account the pass is for and saves the answer; every later step holds you to it.
$script:AccountFile = Join-Path $Evidence 'host-account.txt'

function Use-PassAccount([switch] $Ask) {
  $saved = if (Test-Path $AccountFile) { (Get-Content -LiteralPath $AccountFile -Raw).Trim() } else { '' }
  if ($saved) {
    if ($saved -ne $env:USERNAME) {
      Write-Host "This pass belongs to the account '$saved', but you are signed in as '$env:USERNAME'."
      Write-Host "Sign in as '$saved' and run next.ps1 again, or run next.ps1 -Reset to start over under this account."
      exit 1
    }
    return $saved
  }
  if (-not $Ask) {
    Write-Host 'No account is recorded for this pass yet; run next.ps1 from the start (setup).'
    exit 1
  }
  $name = (Read-Host "Which Windows account is this pass for? Press Enter for '$env:USERNAME'").Trim()
  if (-not $name) { $name = $env:USERNAME }
  if ($name -ne $env:USERNAME) {
    Write-Host "You are signed in as '$env:USERNAME'. Sign in as '$name' first, then run next.ps1."
    exit 1
  }
  Set-Content -LiteralPath $AccountFile -Value $name -Encoding utf8
  Write-Host "Pass account: $name (saved; every later step checks it)."
  return $name
}

function Get-RunValue { (Get-ItemProperty -Path $RunKey -Name Orbit -ErrorAction SilentlyContinue).Orbit }
function Get-BootTime { [DateTimeOffset](Get-CimInstance Win32_OperatingSystem).LastBootUpTime }
# When this desktop session began (explorer starts at logon).
function Get-LogonTime {
  $explorer = Get-Process explorer -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1
  if ($explorer) { [DateTimeOffset]$explorer.StartTime } else { Get-BootTime }
}
# Whether Orbit's own main window — the top-level window titled "Orbit" — is showing.
# MainWindowHandle cannot answer that: it picked the single-instance plugin's helper window
# ("app.orbit.desktop-siw"), a zero-size window Windows reports as visible, so a correctly
# hidden login launch read as shown. Enumerate the process's windows and look at the real one.
if (-not ('HostWin.Enum' -as [type])) {
  Add-Type -Namespace HostWin -Name Enum -MemberDefinition @'
public delegate bool Callback(IntPtr hwnd, IntPtr param);
[DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr param);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int max);
'@
}
function Test-MainWindowVisible([int] $ProcessId) {
  $script:mainVisible = $false
  $callback = [HostWin.Enum+Callback]{
    param($hwnd, $param)
    $owner = 0
    [void][HostWin.Enum]::GetWindowThreadProcessId($hwnd, [ref]$owner)
    if ([int]$owner -eq $ProcessId) {
      $title = New-Object System.Text.StringBuilder 64
      [void][HostWin.Enum]::GetWindowText($hwnd, $title, 64)
      if ($title.ToString() -eq 'Orbit' -and [HostWin.Enum]::IsWindowVisible($hwnd)) { $script:mainVisible = $true }
    }
    $true
  }
  [void][HostWin.Enum]::EnumWindows($callback, [IntPtr]::Zero)
  $script:mainVisible
}
function Get-OrbitProcesses {
  @(Get-Process Orbit -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ id = $_.Id; startedAt = Iso([DateTimeOffset]$_.StartTime); visibleWindow = (Test-MainWindowVisible $_.Id) }
  })
}

# The installed database as raw text, read with shared access because Orbit keeps it open.
# JSON rows survive that; the write-ahead log holds the newest versions.
function Read-DbText {
  $text = ''
  foreach ($name in 'orbit.db', 'orbit.db-wal') {
    $path = Join-Path $DataDir $name
    if (-not (Test-Path $path)) { continue }
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::GetEncoding(28591))
      $text += $reader.ReadToEnd()
    } finally { $stream.Close() }
  }
  $text
}

# Every reminder row, the newest version (by updatedAt) of each id.
function Get-Reminders {
  $byId = @{}
  foreach ($m in [regex]::Matches((Read-DbText), '\{[^{}]*"fireAt":"[^"]+"[^{}]*\}')) {
    try { $r = $m.Value | ConvertFrom-Json } catch { continue }
    if (-not $r.id -or -not $r.status) { continue }
    $have = $byId[$r.id]
    if (-not $have -or ([string]$r.updatedAt -gt [string]$have.updatedAt)) { $byId[$r.id] = $r }
  }
  @($byId.Values)
}
function Get-Reminder([string] $Id) { Get-Reminders | Where-Object { $_.id -eq $Id } | Select-Object -First 1 }
function Format-Reminder($r) {
  if (-not $r) { return $null }
  [ordered]@{ id = $r.id; title = $r.title; fireAt = $r.fireAt; status = $r.status; updatedAt = $r.updatedAt }
}
# The "days" of every bill reminder rule (0 makes a bill fire at its own due time).
function Get-BillRuleDays {
  @([regex]::Matches((Read-DbText), '"kind":"billDueWithin","days":(\d+)') | ForEach-Object { [int]$_.Groups[1].Value } | Select-Object -Unique)
}

# Wait for a pending reminder whose fire time is still ahead: the one the scenario armed.
function Wait-ArmedReminder([int] $Seconds = 90) {
  $until = (Now-Utc).AddSeconds($Seconds)
  do {
    $armed = Get-Reminders | Where-Object { $_.status -eq 'pending' -and ([DateTimeOffset]$_.fireAt) -gt (Now-Utc) } |
      Sort-Object fireAt -Descending | Select-Object -First 1
    if ($armed) { return $armed }
    Start-Sleep -Seconds 3
  } until ((Now-Utc) -gt $until)
  $null
}

# The shell log as objects, every file in order, entries at or after $Since.
function Get-ShellLog([DateTimeOffset] $Since) {
  Get-ChildItem $LogDir -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
    Get-Content -LiteralPath $_.FullName -Encoding UTF8
  } | ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
  } | Where-Object { $_ -and $_.ts -and ([DateTimeOffset]$_.ts) -ge $Since }
}
function Log-Events([DateTimeOffset] $Since, [string] $Subsystem, [string] $Op) {
  @(Get-ShellLog $Since | Where-Object { $_.subsystem -eq $Subsystem -and $_.op -eq $Op })
}
function Copy-ShellLog([string] $Name) {
  $newest = Get-ChildItem $LogDir -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
  if ($newest) { Copy-Item -LiteralPath $newest.FullName -Destination (Join-Path $Evidence $Name) -Force; "saved $(Join-Path $Evidence $Name)" }
}

# The sleep a wake came back from, as Windows itself summarises it. Power-Troubleshooter event 1
# carries "Sleep Time" and "Wake Time" for the whole low-power interval, which is what matters.
# Pairing the raw Kernel-Power events instead goes wrong on Modern Standby machines: this one
# logged "resumed from sleep" two seconds after going down and then a 0.3 s in/out blip at the
# real wake, so the newest "sleep" before the wake was the blip, not the ten minutes asleep.
function Get-SleepWindows([DateTimeOffset] $Since) {
  $parse = {
    param([string] $message, [string] $label)
    # The times are wrapped in left-to-right marks and carry nine fractional digits; .NET
    # parses at most seven.
    $clean = $message -replace [char]0x200E, ''
    if ($clean -notmatch "$label\s*:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z") { return $null }
    $fraction = if ($matches[2]) { $matches[2].Substring(0, [Math]::Min(8, $matches[2].Length)) } else { '' }
    [DateTimeOffset]::Parse("$($matches[1])${fraction}Z")
  }
  @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Power-Troubleshooter'; Id = 1; StartTime = $Since.LocalDateTime } -ErrorAction SilentlyContinue |
    ForEach-Object {
      $slept = & $parse $_.Message 'Sleep Time'
      $woke = & $parse $_.Message 'Wake Time'
      if ($slept -and $woke) { [pscustomobject]@{ sleptAt = $slept; wokeAt = $woke } }
    } | Sort-Object wokeAt)
}

# Sleep and resume, from the System event log: Kernel-Power 42 (entering sleep), 107 (resumed),
# 506/507 (Modern Standby in/out), Power-Troubleshooter 1 (the resume summary with both times).
function Get-PowerEvents([DateTimeOffset] $Since) {
  $out = @()
  foreach ($f in @(
    @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 42, 107, 506, 507; StartTime = $Since.LocalDateTime },
    @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Power-Troubleshooter'; Id = 1; StartTime = $Since.LocalDateTime }
  )) {
    $out += @(Get-WinEvent -FilterHashtable $f -ErrorAction SilentlyContinue | ForEach-Object {
      [ordered]@{ at = Iso([DateTimeOffset]$_.TimeCreated); provider = $_.ProviderName; id = $_.Id; message = (($_.Message -split "`n")[0]).Trim() }
    })
  }
  @($out | Sort-Object { $_.at })
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not ('Native.Screen' -as [type])) {
  Add-Type -Namespace Native -Name Screen -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
'@
}
[Native.Screen]::SetProcessDPIAware() | Out-Null

# The whole desktop as a PNG (a toast is part of the composed desktop, so it is captured).
function Save-Screenshot([string] $Name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $path = Join-Path $Evidence $Name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    "saved $path"
  } finally { $g.Dispose(); $bmp.Dispose() }
}
function Press-Key([byte] $Vk, [byte[]] $With = @()) {
  foreach ($m in $With) { [Native.Screen]::keybd_event($m, 0, 0, [UIntPtr]::Zero) }
  [Native.Screen]::keybd_event($Vk, 0, 0, [UIntPtr]::Zero)
  [Native.Screen]::keybd_event($Vk, 0, 2, [UIntPtr]::Zero)
  foreach ($m in $With) { [Native.Screen]::keybd_event($m, 0, 2, [UIntPtr]::Zero) }
}
# Open the notification centre (Win+N), capture it, close it again.
function Save-NotificationCentre([string] $Name) {
  Press-Key 0x4E @(0x5B)
  Start-Sleep -Milliseconds 1500
  $out = Save-Screenshot $Name
  Press-Key 0x1B
  $out
}

# Poll the shell log for a delivery after $Since until $Deadline; capture the toast the moment
# it is logged (it stays on screen about five seconds). Returns the deliver events found.
function Wait-Delivery([DateTimeOffset] $Since, [DateTimeOffset] $Deadline, [string] $Shot) {
  $announced = $false
  while ($true) {
    $delivered = @(Log-Events $Since 'scheduler' 'deliver')
    if ($delivered.Count -gt 0) {
      Start-Sleep -Milliseconds 600
      Save-Screenshot $Shot | Out-Null
      return $delivered
    }
    if ((Now-Utc) -gt $Deadline) { return @() }
    # Write-Host: the function's output is its return value, so the notice must not join it.
    if (-not $announced) { Write-Host "waiting for the delivery (until $(Local $Deadline) at the latest); do not click the toast..."; $announced = $true }
    Start-Sleep -Seconds 2
  }
}
function Sum-Fired($events) { $n = 0; foreach ($e in $events) { $n += [int]$e.fields.fired }; $n }

function Require-Orbit([string] $Why) {
  if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -eq 0) {
    "Orbit is not running; start it from the Start menu first ($Why)."
    exit 1
  }
}
function Verdict([string] $Scenario, [bool] $Pass, [string] $Because) {
  ''
  if ($Pass) { "SCENARIO ${Scenario}: PASS ($Because)" } else { "SCENARIO ${Scenario}: FAIL ($Because)" }
}
