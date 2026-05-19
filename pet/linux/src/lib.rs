// glib::MainContext::channel 在 glib 0.18 被标记 deprecated（建议换 async-channel），
// 但仍可用且最契合本工程的线程模型，整 crate 放行该 deprecation。
#![allow(deprecated)]

pub mod app;
pub mod assets;
pub mod bubble_store;
pub mod bubble_window;
pub mod config;
pub mod focus_bridge;
pub mod gif_animation;
pub mod hit_region;
pub mod http_server;
pub mod messages;
pub mod paths;
pub mod pet_window;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod state_machine;
pub mod tray;
pub mod vscode_launcher;
