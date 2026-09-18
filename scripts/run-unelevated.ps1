# Run a command without elevation, from an elevated shell.
#
# WebView2 ignores the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS override when the host process
# is elevated, so neither desktop harness (Edge WebDriver's DevToolsActivePort, the cold
# harness's CDP port) can attach from an Administrator shell — and GitHub-hosted Windows
# runners are exactly that. This computes a restricted token for the current user (the
# Safer "normal user" level: Administrators deny-only, medium integrity), starts the command
# with it, inherits the console and environment, waits, and returns its exit code.
#
#   powershell -ExecutionPolicy Bypass -File scripts/run-unelevated.ps1 -CommandLine "pnpm run e2e:desktop"
param(
  [Parameter(Mandatory = $true)]
  [string] $CommandLine
)
$ErrorActionPreference = 'Stop'
if (-not $CommandLine.Trim()) { Write-Error 'nothing to run'; exit 2 }

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class Unelevated {
  [DllImport("advapi32", SetLastError = true)]
  static extern bool SaferCreateLevel(uint scope, uint level, uint openFlags, out IntPtr handle, IntPtr reserved);
  [DllImport("advapi32", SetLastError = true)]
  static extern bool SaferComputeTokenFromLevel(IntPtr level, IntPtr inToken, out IntPtr outToken, uint flags, IntPtr reserved);
  [DllImport("advapi32", SetLastError = true)]
  static extern bool SaferCloseLevel(IntPtr level);
  [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
  [DllImport("advapi32", SetLastError = true)]
  static extern int GetLengthSid(IntPtr sid);
  [DllImport("advapi32", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr token, int cls, ref TOKEN_MANDATORY_LABEL info, int size);
  [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder cmd, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32")]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32")]
  static extern IntPtr LocalFree(IntPtr h);

  [StructLayout(LayoutKind.Sequential)]
  struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)]
  struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

  const uint SAFER_SCOPEID_USER = 2;
  const uint SAFER_LEVELID_NORMALUSER = 0x20000;
  const uint SAFER_LEVEL_OPEN = 1;
  const int TokenIntegrityLevel = 25;
  const uint SE_GROUP_INTEGRITY = 0x20;

  public static int Run(string commandLine, string workingDir) {
    IntPtr level;
    if (!SaferCreateLevel(SAFER_SCOPEID_USER, SAFER_LEVELID_NORMALUSER, SAFER_LEVEL_OPEN, out level, IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "SaferCreateLevel");
    IntPtr token;
    bool computed = SaferComputeTokenFromLevel(level, IntPtr.Zero, out token, 0, IntPtr.Zero);
    int computeError = Marshal.GetLastWin32Error();
    SaferCloseLevel(level);
    if (!computed) throw new Win32Exception(computeError, "SaferComputeTokenFromLevel");

    // The Safer level strips Administrators; the integrity label has to be lowered too, or the
    // process still runs at high integrity and WebView2 still treats it as elevated.
    IntPtr medium;
    if (!ConvertStringSidToSid("S-1-16-8192", out medium))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertStringSidToSid");
    var label = new TOKEN_MANDATORY_LABEL();
    label.Label.Sid = medium;
    label.Label.Attributes = SE_GROUP_INTEGRITY;
    if (!SetTokenInformation(token, TokenIntegrityLevel, ref label, Marshal.SizeOf(label) + GetLengthSid(medium)))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation");
    LocalFree(medium);

    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    PROCESS_INFORMATION pi;
    var cmd = new StringBuilder(commandLine);
    if (!CreateProcessAsUser(token, null, cmd, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, workingDir, ref si, out pi))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser");
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    CloseHandle(token);
    return (int)code;
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp

# Run through cmd so that .cmd shims (pnpm, npm) and PATH lookup behave as in a normal shell.
$line = 'cmd.exe /d /c ' + $CommandLine
$code = [Unelevated]::Run($line, (Get-Location).Path)
exit $code
