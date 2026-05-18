use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::protocol::PetState;

const DEFAULT_IDLE: &[u8] = include_bytes!("../../Assets/idle.gif");
const DEFAULT_THINKING: &[u8] = include_bytes!("../../Assets/thinking.gif");
const DEFAULT_WORKING: &[u8] = include_bytes!("../../Assets/working.gif");
const DEFAULT_ATTENTION: &[u8] = include_bytes!("../../Assets/attention.gif");
const DEFAULT_SLEEPING: &[u8] = include_bytes!("../../Assets/sleeping.gif");

pub fn state_asset_path(assets_dir: &Path, state: PetState) -> PathBuf {
    assets_dir.join(state_asset_name(state))
}

pub fn default_asset_bytes(state: PetState) -> &'static [u8] {
    match state {
        PetState::Idle => DEFAULT_IDLE,
        PetState::Thinking => DEFAULT_THINKING,
        PetState::Working => DEFAULT_WORKING,
        PetState::Attention => DEFAULT_ATTENTION,
        PetState::Sleeping => DEFAULT_SLEEPING,
    }
}

pub fn seed_missing_defaults(assets_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(assets_dir)?;
    for state in [
        PetState::Idle,
        PetState::Thinking,
        PetState::Working,
        PetState::Attention,
        PetState::Sleeping,
    ] {
        let path = state_asset_path(assets_dir, state);
        if !path.exists() {
            fs::write(path, default_asset_bytes(state))?;
        }
    }
    Ok(())
}

fn state_asset_name(state: PetState) -> &'static str {
    match state {
        PetState::Idle => "idle.gif",
        PetState::Thinking => "thinking.gif",
        PetState::Working => "working.gif",
        PetState::Attention => "attention.gif",
        PetState::Sleeping => "sleeping.gif",
    }
}
