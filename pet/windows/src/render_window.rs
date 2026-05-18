use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HINSTANCE, HWND, POINT, SIZE};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, LoadCursorW, RegisterClassW, SetWindowPos, ShowWindow,
    UpdateLayeredWindow, CREATESTRUCTW, GWLP_USERDATA, HTTRANSPARENT, IDC_ARROW, SWP_NOACTIVATE,
    SWP_NOZORDER, SW_SHOW, ULW_ALPHA, WM_NCCREATE, WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
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
        let screen_dc = windows_sys::Win32::Graphics::Gdi::GetDC(null_mut());
        let memory_dc = CreateCompatibleDC(screen_dc);
        let mut bits: *mut c_void = null_mut();
        let bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..zeroed()
            },
            ..zeroed()
        };

        let bitmap = CreateDIBSection(
            memory_dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            null_mut(),
            0,
        );
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
        let old_bitmap = SelectObject(memory_dc, bitmap);

        let src = POINT { x: 0, y: 0 };
        let size = SIZE {
            cx: width,
            cy: height,
        };
        let blend = windows_sys::Win32::Graphics::Gdi::BLENDFUNCTION {
            BlendOp: windows_sys::Win32::Graphics::Gdi::AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: windows_sys::Win32::Graphics::Gdi::AC_SRC_ALPHA as u8,
        };

        UpdateLayeredWindow(
            self.hwnd,
            screen_dc,
            null(),
            &size,
            memory_dc,
            &src,
            0,
            &blend,
            ULW_ALPHA,
        );

        SelectObject(memory_dc, old_bitmap);
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        windows_sys::Win32::Graphics::Gdi::ReleaseDC(null_mut(), screen_dc);
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
