use sema_pet_windows::bubble_store::{BubbleItem, BubbleKind};
use sema_pet_windows::bubble_window::{render_bubbles_bitmap, BUBBLE_WIDTH};

#[test]
fn render_bubbles_bitmap_hides_when_there_are_no_bubbles() {
    assert!(render_bubbles_bitmap(&[]).is_none());
}

#[test]
fn render_bubbles_bitmap_stacks_up_to_three_bubbles() {
    let bubbles = vec![
        bubble("one", BubbleKind::Info),
        bubble("two", BubbleKind::Attention),
        bubble("three", BubbleKind::Info),
    ];

    let bitmap = render_bubbles_bitmap(&bubbles).unwrap();

    assert_eq!(bitmap.width, BUBBLE_WIDTH);
    assert!(bitmap.height > 90);
    assert_eq!(
        bitmap
            .bgra
            .iter()
            .skip(3)
            .step_by(4)
            .filter(|a| **a > 0)
            .count()
            > 100,
        true
    );
}

#[test]
fn render_bubbles_bitmap_draws_chinese_as_glyphs_not_question_marks() {
    let chinese = render_bubbles_bitmap(&[bubble("这是", BubbleKind::Info)]).unwrap();
    let question_marks = render_bubbles_bitmap(&[bubble("??", BubbleKind::Info)]).unwrap();

    assert_ne!(chinese.bgra, question_marks.bgra);
}

fn bubble(text: &str, kind: BubbleKind) -> BubbleItem {
    BubbleItem {
        session_id: "session".to_string(),
        text: text.to_string(),
        kind,
        created_at: 1000,
        expires_at: None,
        sticky: false,
    }
}
