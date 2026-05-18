use serde::Deserialize;

use crate::protocol::{SAY_DEFAULT_TTL_MS, SAY_MAX_CHARS, SAY_MAX_VISIBLE};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BubbleKind {
    #[default]
    Info,
    Attention,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SayOptions {
    pub kind: BubbleKind,
    pub ttl_ms: Option<u64>,
    pub sticky: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BubbleItem {
    pub session_id: String,
    pub text: String,
    pub kind: BubbleKind,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub sticky: bool,
}

#[derive(Default)]
pub struct BubbleStore {
    items: Vec<BubbleItem>,
}

impl BubbleStore {
    pub fn add(&mut self, session_id: &str, text: &str, options: SayOptions, now_ms: u64) {
        self.items.push(BubbleItem {
            session_id: session_id.to_string(),
            text: truncate_text(text),
            kind: options.kind,
            created_at: now_ms,
            expires_at: if options.sticky {
                None
            } else {
                Some(now_ms.saturating_add(options.ttl_ms.unwrap_or(SAY_DEFAULT_TTL_MS)))
            },
            sticky: options.sticky,
        });
        self.trim_to_limit();
    }

    pub fn clear_sticky_for_session(&mut self, session_id: &str) {
        self.items
            .retain(|item| !(item.session_id == session_id && item.sticky));
    }

    pub fn visible(&mut self, now_ms: u64) -> Vec<BubbleItem> {
        self.items.retain(|item| {
            item.expires_at
                .map_or(true, |expires_at| now_ms < expires_at)
        });
        self.items.clone()
    }

    fn trim_to_limit(&mut self) {
        if self.items.len() <= SAY_MAX_VISIBLE {
            return;
        }
        let drain_count = self.items.len() - SAY_MAX_VISIBLE;
        self.items.drain(0..drain_count);
    }
}

fn truncate_text(text: &str) -> String {
    let mut chars = text.chars();
    let truncated: String = chars.by_ref().take(SAY_MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
