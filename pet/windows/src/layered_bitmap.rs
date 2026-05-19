use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HWND, POINT, SIZE};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{UpdateLayeredWindow, ULW_ALPHA};

pub unsafe fn update(hwnd: HWND, width: i32, height: i32, bgra: &[u8]) -> bool {
    let screen_dc = windows_sys::Win32::Graphics::Gdi::GetDC(null_mut());
    if screen_dc.is_null() {
        return false;
    }

    let memory_dc = CreateCompatibleDC(screen_dc);
    if memory_dc.is_null() {
        windows_sys::Win32::Graphics::Gdi::ReleaseDC(null_mut(), screen_dc);
        return false;
    }

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
    if bitmap.is_null() || bits.is_null() {
        DeleteDC(memory_dc);
        windows_sys::Win32::Graphics::Gdi::ReleaseDC(null_mut(), screen_dc);
        return false;
    }

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

    let updated = UpdateLayeredWindow(
        hwnd,
        screen_dc,
        null(),
        &size,
        memory_dc,
        &src,
        0,
        &blend,
        ULW_ALPHA,
    ) != 0;

    SelectObject(memory_dc, old_bitmap);
    DeleteObject(bitmap);
    DeleteDC(memory_dc);
    windows_sys::Win32::Graphics::Gdi::ReleaseDC(null_mut(), screen_dc);
    updated
}
