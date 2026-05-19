use std::mem::zeroed;
use std::ptr::null_mut;
use std::sync::{Arc, Mutex};

use sema_pet_windows::assets::seed_missing_defaults;
use sema_pet_windows::bubble_store::BubbleStore;
use sema_pet_windows::bubble_window::BubbleWindow;
use sema_pet_windows::focus_bridge::FocusBridge;
use sema_pet_windows::hit_window::HitWindow;
use sema_pet_windows::http_server::start_http_server;
use sema_pet_windows::paths::PetPaths;
use sema_pet_windows::render_window::RenderWindow;
use sema_pet_windows::runtime::{RuntimeFile, RuntimeInfo};
use sema_pet_windows::state_machine::StateMachine;
use sema_pet_windows::win32::wide;
use sema_pet_windows::window_coordinator::WindowCoordinator;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, MessageBoxW, TranslateMessage, MSG,
};

fn main() {
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

        let instance = GetModuleHandleW(null_mut());
        RenderWindow::register_class(instance);
        HitWindow::register_class(instance);
        BubbleWindow::register_class(instance);

        let state_machine = Arc::new(Mutex::new(StateMachine::default()));
        let bubble_store = Arc::new(Mutex::new(BubbleStore::default()));
        let focus_bridge = Arc::new(FocusBridge::default());
        let paths = PetPaths::current_user();
        let assets_dir = paths.assets_dir();
        let _ = seed_missing_defaults(&assets_dir);
        let mut coordinator = Box::new(WindowCoordinator::new(
            Arc::clone(&state_machine),
            Arc::clone(&bubble_store),
            Arc::clone(&focus_bridge),
            paths.config_file(),
            assets_dir,
        ));
        let coordinator_ptr = coordinator.as_mut() as *mut WindowCoordinator;
        coordinator.create_windows(instance, coordinator_ptr);
        let Some(notify_hwnd) = coordinator.notify_hwnd() else {
            return;
        };
        let _http_server =
            match start_http_server(state_machine, bubble_store, focus_bridge, notify_hwnd) {
                Ok(handle) => handle,
                Err(error) => {
                    let title = wide("Sema Pet");
                    let text = wide(&format!("Failed to bind 127.0.0.1:24700: {error}"));
                    MessageBoxW(null_mut(), text.as_ptr(), title.as_ptr(), 0);
                    return;
                }
            };
        let _runtime_file = RuntimeFile::write(
            &paths.runtime_file(),
            RuntimeInfo {
                port: sema_pet_windows::protocol::PET_PORT,
                pid: std::process::id(),
                started_at: sema_pet_windows::state_machine::now_ms(),
            },
        )
        .ok();

        let mut msg: MSG = zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
