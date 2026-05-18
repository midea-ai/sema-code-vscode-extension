use serde::{Deserialize, Serialize};

use crate::bubble_store::BubbleKind;

pub const PET_HOST: &str = "127.0.0.1";
pub const PET_PORT: u16 = 24700;
pub const PET_SERVER_HEADER: &str = "x-sema-pet";
pub const PET_SERVER_HEADER_VALUE: &str = "server";
pub const SAY_DEFAULT_TTL_MS: u64 = 5000;
pub const SAY_MAX_VISIBLE: usize = 3;
pub const SAY_MAX_CHARS: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PetState {
    Idle,
    Thinking,
    Working,
    Attention,
    Sleeping,
}

impl PetState {
    pub fn priority(self) -> u8 {
        match self {
            PetState::Attention => 4,
            PetState::Working => 3,
            PetState::Thinking => 2,
            PetState::Idle => 1,
            PetState::Sleeping => 0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPayload {
    pub session_id: String,
    pub cwd: String,
    pub client_pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnregisterPayload {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub session_id: String,
    pub state: PetState,
    pub ts: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SayPayload {
    pub session_id: String,
    pub text: String,
    pub kind: Option<BubbleKind>,
    pub ttl_ms: Option<u64>,
    pub sticky: Option<bool>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum PetCommand {
    Focus { session_id: String },
    Noop,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
}
