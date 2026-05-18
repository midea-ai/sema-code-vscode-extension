use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn launch_vscode_for_cwd(cwd: &str) -> bool {
    let cwd_path = Path::new(cwd);
    if !cwd_path.exists() {
        return false;
    }

    let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let path_env = env::var_os("PATH").and_then(|value| value.into_string().ok());
    for candidate in vscode_launch_candidates(local_app_data.as_deref(), path_env.as_deref()) {
        if !candidate.exists() {
            continue;
        }
        let mut command = Command::new(&candidate);
        command.arg(cwd_path);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        if command.spawn().is_ok() {
            return true;
        }
    }

    false
}

pub fn should_launch_vscode_for_focus_attempt(_has_long_poll_waiter: bool) -> bool {
    true
}

pub fn vscode_launch_candidates(
    local_app_data: Option<&Path>,
    path_env: Option<&str>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(local_app_data) = local_app_data {
        let vscode_dir = local_app_data.join("Programs").join("Microsoft VS Code");
        candidates.push(vscode_dir.join("bin").join("code.cmd"));
        candidates.push(vscode_dir.join("Code.exe"));
    }

    if let Some(path_env) = path_env {
        candidates.extend(env::split_paths(path_env).map(|dir| dir.join("code.cmd")));
    }

    candidates
}
