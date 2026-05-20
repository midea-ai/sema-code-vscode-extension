use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn launch_vscode_for_cwd(cwd: &str) -> bool {
    let cwd_path = Path::new(cwd);

    let path_env = env::var_os("PATH").and_then(|value| value.into_string().ok());
    for candidate in vscode_launch_candidates(env::var_os("HOME").as_deref(), path_env.as_deref()) {
        if !candidate.exists() {
            continue;
        }
        if spawn_detached(Command::new(&candidate).arg(cwd_path)) {
            return true;
        }
    }

    // Flatpak 安装的 VS Code 没有可执行文件路径，走 flatpak run。
    spawn_detached(
        Command::new("flatpak")
            .args(["run", "com.visualstudio.code"])
            .arg(cwd_path),
    )
}

pub fn should_launch_vscode_for_focus_attempt(_has_long_poll_waiter: bool) -> bool {
    // 与 macOS FocusBridge::activateVSCodeWindow 对齐：每次聚焦都 spawn `code <cwd>`。
    // mac 上 `code` CLI 会直接把已开的窗口（含最小化）提到前台；Linux 上 `code` CLI
    // 不做 raise（甚至弹"已就绪"toast），所以 do_focus 还会同时调 X11 _NET_ACTIVE_WINDOW
    // 来弥补。两者一起跑，效果对齐 macOS。
    true
}

pub fn vscode_launch_candidates(
    home: Option<&std::ffi::OsStr>,
    path_env: Option<&str>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path_env) = path_env {
        candidates.extend(env::split_paths(path_env).map(|dir| dir.join("code")));
    }

    candidates.push(PathBuf::from("/usr/bin/code"));
    candidates.push(PathBuf::from("/usr/share/code/bin/code"));
    candidates.push(PathBuf::from("/snap/bin/code"));
    candidates.push(PathBuf::from("/opt/visual-studio-code/bin/code"));

    if let Some(home) = home {
        candidates.push(PathBuf::from(home).join(".local/bin/code"));
    }

    candidates
}

fn spawn_detached(command: &mut Command) -> bool {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}
