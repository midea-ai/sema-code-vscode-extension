use std::path::PathBuf;

use sema_pet_windows::vscode_launcher::{
    should_launch_vscode_for_focus_attempt, vscode_launch_candidates,
};

#[test]
fn vscode_launch_candidates_prefer_local_app_data_install() {
    let local_app_data = PathBuf::from(r"C:\Users\tester\AppData\Local");
    let path_env = r"C:\tools;C:\bin";

    let candidates = vscode_launch_candidates(Some(&local_app_data), Some(path_env));

    assert_eq!(
        candidates[0],
        PathBuf::from(r"C:\Users\tester\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd")
    );
    assert_eq!(
        candidates[1],
        PathBuf::from(r"C:\Users\tester\AppData\Local\Programs\Microsoft VS Code\Code.exe")
    );
    assert!(candidates.contains(&PathBuf::from(r"C:\tools\code.cmd")));
    assert!(candidates.contains(&PathBuf::from(r"C:\bin\code.cmd")));
}

#[test]
fn focus_attempt_launches_vscode_even_when_long_poll_waiter_exists() {
    assert!(should_launch_vscode_for_focus_attempt(true));
    assert!(should_launch_vscode_for_focus_attempt(false));
}
