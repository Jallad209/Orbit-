# Register login launch exactly as tauri-plugin-autostart does from the Settings toggle
# (HKCU Run value "<exe> --background"), so the uninstall in scenario 9 has an Orbit-owned
# value to remove. The toggle's own read-back is covered by the WebDriver resident spec.
$exe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Set-ItemProperty -Path $run -Name Orbit -Value "$exe --background"
"Run\Orbit = $((Get-ItemProperty -Path $run -Name Orbit).Orbit)"
