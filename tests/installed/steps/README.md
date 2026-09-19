# Sandbox steps

Numbered scripts for the installed-build pass, written into the mapped harness folder so they
can be run inside Windows Sandbox without a shared clipboard. Inside the Sandbox, once per
PowerShell session:

    Set-ExecutionPolicy -Scope Process Bypass -Force

then run a step by path, for example `C:\OrbitHarness\steps\02b-restore-ownership.ps1`.

The reboot and sleep scenarios (12–14) are not Sandbox steps; they live in `../host/`.
