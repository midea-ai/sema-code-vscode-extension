//! 用 X11 协议把指定 cwd 对应的 VSCode 窗口提到前台（含取消最小化）。
//!
//! Linux VSCode 的 `code <existing-path>` CLI 不会 raise 已打开的窗口（会弹"已就绪"toast），
//! 这是上游行为，扩展端 `workbench.action.focusActiveEditorGroup` 也只能 focus 内部面板，
//! 不能 raise/取消最小化 toplevel。所以我们自己绕开走 X11：
//!
//! 1. 枚举根窗口 `_NET_CLIENT_LIST` 拿到所有顶层窗口
//! 2. 读每个窗口的 `_NET_WM_PID`，去 `/proc/<pid>/cwd` 拿真实 cwd
//! 3. cwd 匹配上目标 session 的 cwd 时，给该窗口发：
//!    - `_NET_WM_STATE` ClientMessage 移除 `_NET_WM_STATE_HIDDEN`（取消最小化）
//!    - `_NET_ACTIVE_WINDOW` ClientMessage（提到前台）
//!
//! 配合 `code <cwd>` 走 IPC 通知 VSCode 这边激活，能复现 macOS 的体验。

use std::fs;
use std::path::PathBuf;

use xcb::x;
use xcb::Xid;

/// 尝试把 `target_cwd` 对应的 VSCode 顶层窗口 raise 到前台并取消最小化。
/// 找不到匹配窗口、连接失败、缺少必要的 EWMH atom 都静默返回 —— 调用方
/// 应该把它当作 best effort，配合 `code <cwd>` CLI 一起用。
pub fn raise_window_for_cwd(target_cwd: &str) -> bool {
    let target = match canonical(target_cwd) {
        Some(path) => path,
        None => return false,
    };

    let (conn, screen_num) = match xcb::Connection::connect(None) {
        Ok(pair) => pair,
        Err(_) => return false,
    };

    let setup = conn.get_setup();
    let screen = match setup.roots().nth(screen_num as usize) {
        Some(screen) => screen,
        None => return false,
    };
    let root = screen.root();

    let atoms = match Atoms::intern(&conn) {
        Some(atoms) => atoms,
        None => return false,
    };

    let windows = match list_client_windows(&conn, root, atoms.net_client_list) {
        Some(windows) if !windows.is_empty() => windows,
        _ => return false,
    };

    for window in windows {
        let Some(pid) = read_window_pid(&conn, window, atoms.net_wm_pid) else {
            continue;
        };
        let Some(window_cwd) = canonical_pid_cwd(pid) else {
            continue;
        };
        if window_cwd != target {
            continue;
        }
        return activate_window(&conn, root, window, &atoms);
    }
    false
}

fn canonical(path: &str) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

fn canonical_pid_cwd(pid: u32) -> Option<PathBuf> {
    fs::canonicalize(format!("/proc/{pid}/cwd")).ok()
}

struct Atoms {
    net_client_list: x::Atom,
    net_wm_pid: x::Atom,
    net_active_window: x::Atom,
    net_wm_state: x::Atom,
    net_wm_state_hidden: x::Atom,
}

impl Atoms {
    fn intern(conn: &xcb::Connection) -> Option<Self> {
        let names = [
            "_NET_CLIENT_LIST",
            "_NET_WM_PID",
            "_NET_ACTIVE_WINDOW",
            "_NET_WM_STATE",
            "_NET_WM_STATE_HIDDEN",
        ];
        let cookies: Vec<_> = names
            .iter()
            .map(|name| {
                conn.send_request(&x::InternAtom {
                    only_if_exists: false,
                    name: name.as_bytes(),
                })
            })
            .collect();
        let mut atoms = Vec::with_capacity(cookies.len());
        for cookie in cookies {
            let reply = conn.wait_for_reply(cookie).ok()?;
            atoms.push(reply.atom());
        }
        Some(Self {
            net_client_list: atoms[0],
            net_wm_pid: atoms[1],
            net_active_window: atoms[2],
            net_wm_state: atoms[3],
            net_wm_state_hidden: atoms[4],
        })
    }
}

fn list_client_windows(
    conn: &xcb::Connection,
    root: x::Window,
    atom: x::Atom,
) -> Option<Vec<x::Window>> {
    let cookie = conn.send_request(&x::GetProperty {
        delete: false,
        window: root,
        property: atom,
        r#type: x::ATOM_WINDOW,
        long_offset: 0,
        long_length: 1024,
    });
    let reply = conn.wait_for_reply(cookie).ok()?;
    Some(reply.value::<x::Window>().to_vec())
}

fn read_window_pid(conn: &xcb::Connection, window: x::Window, atom: x::Atom) -> Option<u32> {
    let cookie = conn.send_request(&x::GetProperty {
        delete: false,
        window,
        property: atom,
        r#type: x::ATOM_CARDINAL,
        long_offset: 0,
        long_length: 1,
    });
    let reply = conn.wait_for_reply(cookie).ok()?;
    reply.value::<u32>().first().copied()
}

fn activate_window(
    conn: &xcb::Connection,
    root: x::Window,
    window: x::Window,
    atoms: &Atoms,
) -> bool {
    // 1) 先 map 一下，应对窗口被 unmap（最小化时部分 WM 会 unmap）的情况。
    conn.send_request(&x::MapWindow { window });

    // 2) 取消最小化：发 _NET_WM_STATE 移除 _NET_WM_STATE_HIDDEN。
    //    data.l[0]=0 (remove), data.l[1]=_NET_WM_STATE_HIDDEN。
    let remove_hidden = x::ClientMessageEvent::new(
        window,
        atoms.net_wm_state,
        x::ClientMessageData::Data32([0, atoms.net_wm_state_hidden.resource_id(), 0, 1, 0]),
    );
    conn.send_request(&x::SendEvent {
        propagate: false,
        destination: x::SendEventDest::Window(root),
        event_mask: x::EventMask::SUBSTRUCTURE_REDIRECT | x::EventMask::SUBSTRUCTURE_NOTIFY,
        event: &remove_hidden,
    });

    // 3) 提到前台：发 _NET_ACTIVE_WINDOW；source=1 (application)，timestamp=0。
    let activate = x::ClientMessageEvent::new(
        window,
        atoms.net_active_window,
        x::ClientMessageData::Data32([1, 0, 0, 0, 0]),
    );
    conn.send_request(&x::SendEvent {
        propagate: false,
        destination: x::SendEventDest::Window(root),
        event_mask: x::EventMask::SUBSTRUCTURE_REDIRECT | x::EventMask::SUBSTRUCTURE_NOTIFY,
        event: &activate,
    });

    conn.flush().is_ok()
}
