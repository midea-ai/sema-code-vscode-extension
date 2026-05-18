use std::ffi::c_void;
use std::mem::zeroed;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HINSTANCE, HWND};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, LoadCursorW, RegisterClassW, SetWindowPos, ShowWindow,
    CREATESTRUCTW, GWLP_USERDATA, HTTRANSPARENT, IDC_ARROW, SWP_NOACTIVATE, SWP_NOZORDER, SW_SHOW,
    WM_NCCREATE, WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::window_coordinator::WindowCoordinator;

const CLASS_NAME: &[u16] = &[
    'S' as u16, 'e' as u16, 'm' as u16, 'a' as u16, 'P' as u16, 'e' as u16, 't' as u16, 'R' as u16,
    'e' as u16, 'n' as u16, 'd' as u16, 'e' as u16, 'r' as u16, 0,
];

pub struct RenderWindow {
    hwnd: HWND,
}

impl RenderWindow {
    pub unsafe fn register_class(instance: HINSTANCE) {
        let wc = WNDCLASSW {
            lpfnWndProc: Some(render_wnd_proc),
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
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,
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

    pub unsafe fn update_bitmap(&self, width: i32, height: i32, bgra: &[u8]) {
        crate::layered_bitmap::update(self.hwnd, width, height, bgra);
    }
}

unsafe extern "system" fn render_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if msg == WM_NCHITTEST {
        return HTTRANSPARENT as isize;
    }

    if msg == WM_NCCREATE {
        let create = lparam as *const CREATESTRUCTW;
        windows_sys::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
            hwnd,
            GWLP_USERDATA,
            (*create).lpCreateParams as isize,
        );
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}
