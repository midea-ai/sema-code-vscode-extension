use std::fs;
use std::path::PathBuf;

use sema_pet_windows::config::{PetConfig, WindowPosition};
use sema_pet_windows::runtime::{RuntimeFile, RuntimeInfo};

#[test]
fn config_loads_default_when_file_is_missing_or_invalid() {
    let dir = test_dir("config-defaults");
    let path = dir.join("config.json");

    assert_eq!(PetConfig::load(&path), PetConfig::default());

    fs::write(&path, "{not json").unwrap();
    assert_eq!(PetConfig::load(&path), PetConfig::default());
}

#[test]
fn config_saves_and_loads_window_position() {
    let dir = test_dir("config-position");
    let path = dir.join("config.json");
    let config = PetConfig {
        enabled: Some(false),
        window_position: Some(WindowPosition { x: -120, y: 640 }),
    };

    config.save(&path).unwrap();

    assert_eq!(PetConfig::load(&path), config);
}

#[test]
fn runtime_file_writes_info_and_removes_file_on_drop() {
    let dir = test_dir("runtime-drop");
    let path = dir.join("runtime.json");
    let info = RuntimeInfo {
        port: 24700,
        pid: 4242,
        started_at: 1000,
    };

    {
        let _runtime = RuntimeFile::write(&path, info).unwrap();
        let saved = RuntimeInfo::load(&path).unwrap();
        assert_eq!(saved, info);
    }

    assert!(!path.exists());
}

fn test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sema-pet-windows-{name}-{}", std::process::id()));
    if dir.exists() {
        fs::remove_dir_all(&dir).unwrap();
    }
    fs::create_dir_all(&dir).unwrap();
    dir
}
