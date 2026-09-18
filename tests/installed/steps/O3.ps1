# Restore Orbit's ownership of orbit:// (the installer never takes it back by design):
# remove the fake handler, reinstall, and verify the snapshot is clean.
Remove-Item -Path 'HKCU:\Software\Classes\orbit' -Recurse -Force -ErrorAction SilentlyContinue
Start-Process 'C:\OrbitInstallers\Orbit_0.1.0-alpha.2_x64-setup.exe' -ArgumentList '/S' -Wait
& 'C:\OrbitHarness\checks.ps1' -Action snapshot
