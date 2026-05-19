use std::ffi::c_void;
use std::mem::zeroed;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HINSTANCE, HWND};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetWindowLongPtrW, LoadCursorW, RegisterClassW, SetCursor,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, CREATESTRUCTW, GWLP_USERDATA, HTCLIENT, IDC_ARROW,
    SWP_NOACTIVATE, SWP_NOZORDER, SW_SHOW, WM_DRAWITEM, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MEASUREITEM, WM_MOUSEMOVE, WM_NCCREATE, WM_NCHITTEST, WM_RBUTTONUP, WM_SETCURSOR, WM_TIMER,
    WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use crate::window_coordinator::WindowCoordinator;
use crate::window_messages::{
    WM_APP_BUBBLES_CHANGED, WM_APP_QUIT, WM_APP_STATE_CHANGED, WM_APP_TRAY_CALLBACK,
};

const CLASS_NAME: &[u16] = &[
    'S' as u16, 'e' as u16, 'm' as u16, 'a' as u16, 'P' as u16, 'e' as u16, 't' as u16, 'H' as u16,
    'i' as u16, 't' as u16, 0,
];

pub struct HitWindow {
    hwnd: HWND,
}

impl HitWindow {
    pub unsafe fn register_class(instance: HINSTANCE) {
        let wc = WNDCLASSW {
            lpfnWndProc: Some(hit_wnd_proc),
            hInstance: instance,
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            lpszClassName: CLASS_NAME.as_ptr(),
            ..zeroed()
        };
        RegisterClassW(&wc);
    }

    pub unsafe fn create(
        instance: HINSTANCE,
        coordinator: *mut WindowCoordinator,
        x: i32,
        y: i32,
        size: i32,
    ) -> Self {
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            CLASS_NAME.as_ptr(),
            CLASS_NAME.as_ptr(),
            WS_POPUP,
            x,
            y,
            size,
            size,
            null_mut(),
            null_mut(),
            instance,
            coordinator as *const c_void,
        );
        ShowWindow(hwnd, SW_SHOW);
        Self { hwnd }
    }

    pub fn hwnd(&self) -> HWND {
        self.hwnd
    }

    pub unsafe fn move_to(&self, x: i32, y: i32, size: i32) {
        SetWindowPos(
            self.hwnd,
            null_mut(),
            x,
            y,
            size,
            size,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

unsafe extern "system" fn hit_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if msg == WM_NCCREATE {
        let create = lparam as *const CREATESTRUCTW;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, (*create).lpCreateParams as isize);
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }

    let coordinator = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowCoordinator;
    if !coordinator.is_null() {
        match msg {
            WM_NCHITTEST => return HTCLIENT as isize,
            WM_SETCURSOR => {
                SetCursor(LoadCursorW(null_mut(), IDC_ARROW));
                return 1;
            }
            WM_APP_STATE_CHANGED => {
                (*coordinator).on_state_changed();
                return 0;
            }
            WM_APP_BUBBLES_CHANGED => {
                (*coordinator).on_bubbles_changed();
                return 0;
            }
            WM_APP_QUIT => {
                (*coordinator).quit();
                return 0;
            }
            WM_APP_TRAY_CALLBACK => {
                (*coordinator).on_tray_callback(lparam);
                return 0;
            }
            WM_MEASUREITEM | WM_DRAWITEM | WM_LBUTTONDOWN | WM_MOUSEMOVE | WM_LBUTTONUP
            | WM_RBUTTONUP => {
                return (*coordinator).on_hit_window_message(hwnd, msg, wparam, lparam);
            }
            WM_TIMER => {
                (*coordinator).on_timer(wparam);
                return 0;
            }
            _ => {}
        }
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}
