use sema_pet_windows::bubble_store::{BubbleKind, BubbleStore, SayOptions};

#[test]
fn add_keeps_three_newest_bubbles_and_truncates_text() {
    let mut store = BubbleStore::default();

    store.add("a", "first", SayOptions::default(), 1000);
    store.add("b", "second", SayOptions::default(), 1001);
    store.add("c", "third", SayOptions::default(), 1002);
    store.add(
        "d",
        "abcdefghijklmnopqrstuvwxyz0123456789EXTRA",
        SayOptions::default(),
        1003,
    );

    let bubbles = store.visible(1003);
    assert_eq!(bubbles.len(), 3);
    assert_eq!(bubbles[0].text, "second");
    assert_eq!(bubbles[1].text, "third");
    assert_eq!(
        bubbles[2].text,
        "abcdefghijklmnopqrstuvwxyz0123456789EXTR..."
    );
}

#[test]
fn visible_expires_non_sticky_bubbles_after_ttl() {
    let mut store = BubbleStore::default();

    store.add(
        "session-a",
        "short lived",
        SayOptions {
            ttl_ms: Some(500),
            ..SayOptions::default()
        },
        1000,
    );

    assert_eq!(store.visible(1499).len(), 1);
    assert_eq!(store.visible(1500).len(), 0);
}

#[test]
fn sticky_bubbles_survive_ttl_until_session_state_changes() {
    let mut store = BubbleStore::default();

    store.add(
        "session-a",
        "needs attention",
        SayOptions {
            kind: BubbleKind::Attention,
            sticky: true,
            ttl_ms: Some(500),
        },
        1000,
    );
    store.add(
        "session-b",
        "other",
        SayOptions {
            sticky: true,
            ..SayOptions::default()
        },
        1001,
    );

    assert_eq!(store.visible(10_000).len(), 2);

    store.clear_sticky_for_session("session-a");
    let visible = store.visible(10_000);

    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].session_id, "session-b");
}
