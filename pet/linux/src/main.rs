#![allow(deprecated)]

use std::sync::{Arc, Mutex};

use sema_pet_linux::app;
use sema_pet_linux::assets::seed_missing_defaults;
use sema_pet_linux::bubble_store::BubbleStore;
use sema_pet_linux::focus_bridge::FocusBridge;
use sema_pet_linux::http_server::start_http_server;
use sema_pet_linux::messages::UiMessage;
use sema_pet_linux::paths::PetPaths;
use sema_pet_linux::protocol::PET_PORT;
use sema_pet_linux::runtime::{RuntimeFile, RuntimeInfo};
use sema_pet_linux::state_machine::{now_ms, StateMachine};

fn main() {
    // 必须 X11/Xwayland：桌宠靠 override-redirect 绕过 WM 实现 always-on-top
    // （类比 Windows WS_EX_TOPMOST / macOS NSWindow.Level.floating）；
    // Wayland 协议根本没有 OR 概念，应用也不能强制置顶。无条件强制 x11，
    // 没有 X server / XWayland 就让 GTK init 报错，而不是悄悄退化到 Wayland
    // 然后被 VS Code 等窗口盖住。用户显式设过 GDK_BACKEND 才尊重其意图。
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    if gtk::init().is_err() {
        eprintln!(
            "Sema Pet: 无法初始化 GTK（需要 X11 或 XWayland —— \
             桌宠依赖 X11 override-redirect 强制置顶，纯 Wayland 不支持）"
        );
        std::process::exit(1);
    }

    let paths = PetPaths::current_user();
    let assets_dir = paths.assets_dir();
    let _ = seed_missing_defaults(&assets_dir);

    let state_machine = Arc::new(Mutex::new(StateMachine::default()));
    let bubble_store = Arc::new(Mutex::new(BubbleStore::default()));
    let focus_bridge = Arc::new(FocusBridge::default());

    // HTTP / 托盘线程 → GTK 主线程的消息通道，取代 Windows 的 PostMessageW。
    let (ui_tx, ui_rx) = glib::MainContext::channel::<UiMessage>(glib::Priority::DEFAULT);

    let http_server = match start_http_server(
        Arc::clone(&state_machine),
        Arc::clone(&bubble_store),
        Arc::clone(&focus_bridge),
        ui_tx.clone(),
    ) {
        Ok(handle) => handle,
        Err(error) => {
            eprintln!("Sema Pet: 无法绑定 127.0.0.1:24700 —— {error}");
            std::process::exit(1);
        }
    };

    // runtime.json 供扩展端探活定位；进程退出时 Drop 自动清理。
    let runtime_file = RuntimeFile::write(
        &paths.runtime_file(),
        RuntimeInfo {
            port: PET_PORT,
            pid: std::process::id(),
            started_at: now_ms(),
        },
    )
    .ok();

    app::start(
        state_machine,
        bubble_store,
        focus_bridge,
        paths.config_file(),
        assets_dir,
        ui_tx,
        ui_rx,
    );

    gtk::main();

    drop(http_server);
    drop(runtime_file);
}
