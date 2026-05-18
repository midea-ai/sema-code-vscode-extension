use sema_pet_windows::protocol::PetState;
use sema_pet_windows::state_machine::SessionSnapshot;
use sema_pet_windows::tray::{build_menu_items, MenuAction, MenuItemKind};

fn session(session_id: &str, project_name: &str, state: PetState) -> SessionSnapshot {
    SessionSnapshot {
        session_id: session_id.to_string(),
        cwd: format!(r"C:\work\{project_name}"),
        project_name: project_name.to_string(),
        state,
        last_event_at: 100,
        client_pid: None,
    }
}

#[test]
fn menu_items_include_sessions_separator_and_exit() {
    let items = build_menu_items(&[
        session("session-a", "admin-portal", PetState::Attention),
        session("session-b", "sema-vscode-extension", PetState::Working),
    ]);

    assert_eq!(items.len(), 4);
    assert_eq!(items[0].label, "\u{1F7E0} admin-portal - attention");
    assert_eq!(
        items[0].kind,
        MenuItemKind::Command(MenuAction::FocusSession("session-a".to_string()))
    );
    assert_eq!(items[1].label, "\u{1F7E2} sema-vscode-extension - working");
    assert_eq!(items[2].kind, MenuItemKind::Separator);
    assert_eq!(items[3].label, "Exit Sema Pet");
    assert_eq!(items[3].kind, MenuItemKind::Command(MenuAction::Quit));
}

#[test]
fn menu_items_show_empty_state_when_no_sessions_are_registered() {
    let items = build_menu_items(&[]);

    assert_eq!(items.len(), 3);
    assert_eq!(items[0].label, "No active sessions");
    assert_eq!(items[0].kind, MenuItemKind::Disabled);
    assert_eq!(items[1].kind, MenuItemKind::Separator);
    assert_eq!(items[2].kind, MenuItemKind::Command(MenuAction::Quit));
}
