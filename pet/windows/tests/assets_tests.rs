use std::fs;
use std::path::PathBuf;

use sema_pet_windows::assets::{default_asset_bytes, seed_missing_defaults, state_asset_path};
use sema_pet_windows::protocol::PetState;

#[test]
fn state_asset_path_uses_user_assets_directory() {
    let dir = test_dir("state-path");

    assert_eq!(
        state_asset_path(&dir, PetState::Attention),
        dir.join("attention.gif")
    );
    assert_eq!(
        state_asset_path(&dir, PetState::Sleeping),
        dir.join("sleeping.gif")
    );
}

#[test]
fn seed_missing_defaults_writes_missing_gifs_without_overwriting_existing_files() {
    let dir = test_dir("seed-defaults");
    fs::create_dir_all(&dir).unwrap();
    let custom_idle = b"custom idle";
    fs::write(dir.join("idle.gif"), custom_idle).unwrap();

    seed_missing_defaults(&dir).unwrap();

    assert_eq!(fs::read(dir.join("idle.gif")).unwrap(), custom_idle);
    assert_eq!(
        fs::read(dir.join("thinking.gif")).unwrap(),
        default_asset_bytes(PetState::Thinking)
    );
    assert!(dir.join("working.gif").exists());
    assert!(dir.join("attention.gif").exists());
    assert!(dir.join("sleeping.gif").exists());
}

fn test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "sema-pet-windows-assets-{name}-{}",
        std::process::id()
    ));
    if dir.exists() {
        fs::remove_dir_all(&dir).unwrap();
    }
    fs::create_dir_all(&dir).unwrap();
    dir
}
