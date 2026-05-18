use sema_pet_windows::config::{PetConfig, WindowPosition};
use sema_pet_windows::window_coordinator::initial_position_from_config;
use windows_sys::Win32::Foundation::POINT;

#[test]
fn initial_position_uses_configured_window_position_when_present() {
    let default = POINT { x: 1200, y: 160 };
    let config = PetConfig {
        enabled: None,
        window_position: Some(WindowPosition { x: -40, y: 500 }),
    };

    assert_eq!(initial_position_from_config(&config, default).x, -40);
    assert_eq!(initial_position_from_config(&config, default).y, 500);
}

#[test]
fn initial_position_falls_back_to_default_without_configured_position() {
    let default = POINT { x: 1200, y: 160 };

    assert_eq!(
        initial_position_from_config(&PetConfig::default(), default).x,
        1200
    );
    assert_eq!(
        initial_position_from_config(&PetConfig::default(), default).y,
        160
    );
}
