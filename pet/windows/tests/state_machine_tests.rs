use sema_pet_windows::protocol::PetState;
use sema_pet_windows::state_machine::StateMachine;

#[test]
fn snapshot_picks_highest_priority_session() {
    let mut machine = StateMachine::default();
    machine.register("a".into(), "C:\\work\\alpha".into(), Some(10), 100);
    machine.register("b".into(), "C:\\work\\beta".into(), Some(20), 200);

    machine.update_state("a", PetState::Working, 300);
    machine.update_state("b", PetState::Attention, 250);

    let snapshot = machine.snapshot(400);

    assert_eq!(snapshot.state, PetState::Attention);
    assert_eq!(snapshot.winner_session_id.as_deref(), Some("b"));
}

#[test]
fn snapshot_breaks_priority_ties_by_latest_event() {
    let mut machine = StateMachine::default();
    machine.register("a".into(), "C:\\work\\alpha".into(), None, 100);
    machine.register("b".into(), "C:\\work\\beta".into(), None, 200);

    machine.update_state("a", PetState::Working, 300);
    machine.update_state("b", PetState::Working, 500);

    let snapshot = machine.snapshot(600);

    assert_eq!(snapshot.winner_session_id.as_deref(), Some("b"));
}

#[test]
fn snapshot_shows_sleeping_when_all_sessions_idle_for_an_hour() {
    let mut machine = StateMachine::default();
    machine.register("a".into(), "C:\\work\\alpha".into(), None, 100);

    let snapshot = machine.snapshot(60 * 60 * 1000 + 100);

    assert_eq!(snapshot.state, PetState::Sleeping);
    assert_eq!(snapshot.winner_session_id.as_deref(), Some("a"));
}
