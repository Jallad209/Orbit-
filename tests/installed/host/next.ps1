# The host-account pass (scenarios 12-14), one command at a time. Run it, do what it says,
# run it again. A step that fails is offered again next time; a passed step is not repeated.
#
#   C:\Orbit\tests\installed\host\next.ps1              run the next step
#   C:\Orbit\tests\installed\host\next.ps1 -Redo        run the last step again
#   C:\Orbit\tests\installed\host\next.ps1 -Step 14     jump to a step (setup, 12, 12v, 13, 13v, 14, 14v, finish)
#   C:\Orbit\tests\installed\host\next.ps1 -Reset       start over
param([switch] $Redo, [string] $Step, [switch] $Reset)
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$evidence = Join-Path (Split-Path $here -Parent) 'evidence'
$progress = Join-Path $evidence 'host-progress.json'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null

$plan = @(
  @{ n = 'setup';  name = 'install the candidate for this account';                 before = 'Nothing to do first.';                                                                script = '00-setup.ps1' },
  @{ n = '12';     name = 'login launch -> restart -> hidden start -> delivery';    before = 'Orbit is running, the Days-0 reminder rule exists, "Start Orbit at login" is ON.';    script = '12-arm.ps1' },
  @{ n = '12v';    name = 'after the restart: hidden start and delivery';           before = 'You restarted and just signed in as OrbitTest.';                                     script = '12-verify.ps1' },
  @{ n = '13';     name = 'login launch off -> restart -> no Orbit';                before = 'Orbit is running.';                                                                   script = '13-arm.ps1' },
  @{ n = '13v';    name = 'after the restart: nothing started';                     before = 'You restarted and just signed in as OrbitTest.';                                     script = '13-verify.ps1' },
  @{ n = '14';     name = 'sleep across a due time (arms, then sleeps the machine)'; before = 'Orbit is running (start it from the Start menu if not).';                          script = '14-arm.ps1' },
  @{ n = '14v';    name = 'after the resume: one delivery, no duplicate';           before = 'The machine slept past the due time and you just woke it and signed in.';             script = '14-verify.ps1' },
  @{ n = 'finish'; name = 'uninstall from this account';                            before = 'Right-click the tray icon -> Quit.';                                                  script = '99-finish.ps1' }
)

$state = if ((Test-Path $progress) -and -not $Reset) { Get-Content $progress -Raw | ConvertFrom-Json } else { [pscustomobject]@{ index = 0; results = @() } }
$i = [int]$state.index
if ($Redo -and $i -gt 0) { $i-- }
if ($Step) {
  $i = [array]::FindIndex($plan, [Predicate[object]]{ param($p) $p.n -eq $Step })
  if ($i -lt 0) { "no step named '$Step'; steps: $(($plan | ForEach-Object { $_.n }) -join ', ')"; exit 1 }
}
if ($i -ge $plan.Count) { 'All host steps are done. Sign out of OrbitTest and tell Claude.'; exit 0 }
$current = $plan[$i]

''
"=== Step $($current.n): $($current.name) ==="
"FIRST: $($current.before)"
$null = Read-Host 'Press Enter when that is done'
''
$global:LASTEXITCODE = 0
$ok = $true
try { & (Join-Path $here $current.script) } catch { "step failed: $($_.Exception.Message)"; $ok = $false }
if ($LASTEXITCODE -ne 0) { $ok = $false }

$state.results = @($state.results) + "$($current.n): $(if ($ok) { 'ran' } else { 'FAILED' }) $([DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss'))Z"
$state.index = if ($ok) { $i + 1 } else { $i }
$state | ConvertTo-Json | Set-Content $progress -Encoding utf8

''
if (-not $ok) {
  "That step did not complete; fix what it printed and run next.ps1 again (it repeats step $($current.n))."
} elseif ($state.index -lt $plan.Count) {
  $next = $plan[$state.index]
  "NEXT (step $($next.n)): $($next.before)"
  'Then run:  C:\Orbit\tests\installed\host\next.ps1     (or press Up then Enter)'
} else {
  'That was the last host step.'
}
