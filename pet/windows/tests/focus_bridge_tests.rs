use std::sync::Arc;
use std::time::Duration;

use sema_pet_windows::focus_bridge::FocusBridge;
use sema_pet_windows::protocol::PetCommand;

#[test]
fn wait_command_returns_focus_for_matching_active_waiter() {
    let bridge = Arc::new(FocusBridge::default());
    let waiter = Arc::clone(&bridge);

    let handle =
        std::thread::spawn(move || waiter.wait_command("session-a", Duration::from_secs(1)));
    std::thread::sleep(Duration::from_millis(25));

    assert!(bridge.enqueue_focus("session-a".into()));

    assert_eq!(
        handle.join().unwrap(),
        PetCommand::Focus {
            session_id: "session-a".into()
        }
    );
}

#[test]
fn wait_command_ignores_other_sessions_until_timeout() {
    let bridge = FocusBridge::default();
    assert!(!bridge.enqueue_focus("session-b".into()));

    let command = bridge.wait_command("session-a", Duration::from_millis(1));

    assert_eq!(command, PetCommand::Noop);
}

#[test]
fn wait_command_unblocks_when_focus_is_enqueued() {
    let bridge = Arc::new(FocusBridge::default());
    let waiter = Arc::clone(&bridge);

    let handle =
        std::thread::spawn(move || waiter.wait_command("session-a", Duration::from_secs(1)));
    std::thread::sleep(Duration::from_millis(25));
    bridge.enqueue_focus("session-a".into());

    assert_eq!(
        handle.join().unwrap(),
        PetCommand::Focus {
            session_id: "session-a".into()
        }
    );
}

#[test]
fn enqueue_focus_reports_whether_matching_session_is_waiting() {
    let bridge = Arc::new(FocusBridge::default());
    let waiter = Arc::clone(&bridge);

    let handle =
        std::thread::spawn(move || waiter.wait_command("session-a", Duration::from_secs(1)));

    std::thread::sleep(Duration::from_millis(25));

    assert!(bridge.enqueue_focus("session-a".into()));
    assert_eq!(
        handle.join().unwrap(),
        PetCommand::Focus {
            session_id: "session-a".into()
        }
    );
}

#[test]
fn enqueue_focus_drops_command_when_session_is_not_waiting() {
    let bridge = FocusBridge::default();

    assert!(!bridge.enqueue_focus("session-a".into()));

    assert_eq!(
        bridge.wait_command("session-a", Duration::from_millis(1)),
        PetCommand::Noop
    );
}

#[test]
fn enqueue_focus_bridges_short_reconnect_gap_after_waiter_timeout() {
    let bridge = FocusBridge::default();

    assert_eq!(
        bridge.wait_command("session-a", Duration::from_millis(1)),
        PetCommand::Noop
    );

    assert!(bridge.enqueue_focus("session-a".into()));

    assert_eq!(
        bridge.wait_command("session-a", Duration::from_millis(1)),
        PetCommand::Focus {
            session_id: "session-a".into()
        }
    );
}

#[test]
fn focus_command_serializes_with_camel_case_session_id() {
    let command = PetCommand::Focus {
        session_id: "session-a".into(),
    };

    let json = serde_json::to_string(&command).unwrap();

    assert_eq!(json, r#"{"type":"focus","sessionId":"session-a"}"#);
}
