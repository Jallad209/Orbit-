//! Who owns the `orbit://` scheme for this Windows user. The NSIS installer registers
//! `HKCU\Software\Classes\orbit\shell\open\command` only when nothing else owns it
//! (`windows/hooks.nsh`), so a notification click may reach another program, another Orbit
//! installation, or nothing at all; Settings → Desktop says which, instead of promising
//! that clicks open Orbit.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProtocolOwner {
    /// The command names this executable: notification clicks reach this installation.
    ThisInstallation,
    /// The command names an `orbit.exe` elsewhere (an installed copy while a development
    /// build runs, or the other way round).
    OtherOrbit,
    /// Another program owns the scheme; the installer left it alone.
    Foreign,
    /// Nothing is registered for this user.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolHandler {
    pub owner: ProtocolOwner,
    /// The registered command, verbatim: an executable path and `"%1"`, never user data.
    pub command: Option<String>,
    /// The executable that command names, when it could be parsed.
    pub executable: Option<String>,
}

/// The first token of a shell command: quoted, or up to the first space.
fn executable_of(command: &str) -> Option<String> {
    let trimmed = command.trim_start();
    if let Some(rest) = trimmed.strip_prefix('"') {
        rest.split('"').next().map(str::to_string)
    } else {
        trimmed.split_whitespace().next().map(str::to_string)
    }
    .filter(|s| !s.is_empty())
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase(),
    }
}

/// The last path segment of a Windows command path, whichever separator it uses (the
/// registry value is a Windows path even when the tests run elsewhere).
fn file_name_of(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

pub fn classify(command: Option<&str>, current_exe: &Path) -> ProtocolHandler {
    let command = command.map(str::trim).filter(|c| !c.is_empty());
    let executable = command.and_then(executable_of);
    let owner = match executable.as_deref() {
        None => ProtocolOwner::Missing,
        Some(exe) if same_file(Path::new(exe), current_exe) => ProtocolOwner::ThisInstallation,
        Some(exe) if file_name_of(exe).eq_ignore_ascii_case("orbit.exe") => {
            ProtocolOwner::OtherOrbit
        }
        Some(_) => ProtocolOwner::Foreign,
    };
    ProtocolHandler {
        owner,
        command: command.map(str::to_string),
        executable,
    }
}

/// `HKCU\Software\Classes\orbit\shell\open\command`'s default value, if any.
#[cfg(windows)]
pub fn registered_command() -> Option<String> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    let subkey = w!("Software\\Classes\\orbit\\shell\\open\\command");
    let mut size: u32 = 0;
    // First call sizes the buffer; the second fills it.
    let probe = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey,
            PCWSTR::null(),
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        )
    };
    if probe.is_err() || size == 0 {
        return None;
    }
    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey,
            PCWSTR::null(),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if read.is_err() {
        return None;
    }
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}

#[cfg(not(windows))]
pub fn registered_command() -> Option<String> {
    None
}

pub fn status() -> ProtocolHandler {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::new());
    classify(registered_command().as_deref(), &exe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_installation_other_orbit_foreign_and_missing() {
        let temp = tempfile::tempdir().unwrap();
        let exe = temp.path().join("orbit.exe");
        std::fs::write(&exe, b"").unwrap();
        let quoted = format!("\"{}\" \"%1\"", exe.display());

        let mine = classify(Some(&quoted), &exe);
        assert_eq!(mine.owner, ProtocolOwner::ThisInstallation);
        assert_eq!(mine.executable.as_deref(), Some(exe.to_str().unwrap()));

        let elsewhere = temp.path().join("elsewhere").join("orbit.exe");
        let other = classify(Some(&format!("\"{}\" \"%1\"", elsewhere.display())), &exe);
        assert_eq!(other.owner, ProtocolOwner::OtherOrbit);

        let foreign = classify(Some("\"C:\\Windows\\System32\\notepad.exe\" \"%1\""), &exe);
        assert_eq!(foreign.owner, ProtocolOwner::Foreign);
        assert_eq!(
            foreign.executable.as_deref(),
            Some("C:\\Windows\\System32\\notepad.exe")
        );

        assert_eq!(classify(None, &exe).owner, ProtocolOwner::Missing);
        assert_eq!(classify(Some("   "), &exe).owner, ProtocolOwner::Missing);
    }

    #[test]
    fn unquoted_commands_and_case_differences_are_understood() {
        let temp = tempfile::tempdir().unwrap();
        let exe = temp.path().join("orbit.exe");
        std::fs::write(&exe, b"").unwrap();
        let upper = exe.to_string_lossy().to_uppercase();
        assert_eq!(
            classify(Some(&format!("{upper} %1")), &exe).owner,
            ProtocolOwner::ThisInstallation
        );
        assert_eq!(
            classify(Some("D:\\Tools\\ORBIT.EXE \"%1\""), &exe).owner,
            ProtocolOwner::OtherOrbit
        );
    }
}
