use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HINSTANCE, HWND, POINT, RECT, SIZE};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW,
    SelectObject, SetBkMode, SetTextColor, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, FW_NORMAL, TRANSPARENT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, LoadCursorW, RegisterClassW, SetWindowPos, ShowWindow,
    UpdateLayeredWindow, CREATESTRUCTW, GWLP_USERDATA, HTTRANSPARENT, IDC_ARROW, SWP_NOACTIVATE,
    SWP_NOZORDER, SW_HIDE, SW_SHOW, ULW_ALPHA, WM_NCCREATE, WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::bubble_store::{BubbleItem, BubbleKind};
use crate::window_coordinator::WindowCoordinator;

pub const BUBBLE_WIDTH: i32 = 240;
const BUBBLE_MAX_WIDTH: i32 = BUBBLE_WIDTH;
const BUBBLE_HEIGHT: i32 = 26;
const BUBBLE_GAP: i32 = 4;
const BUBBLE_RADIUS: i32 = 8;
const TEXT_PADDING_X: i32 = 10;
const TEXT_PADDING_Y: i32 = 6;
const TEXT_MAX_WIDTH: i32 = 220;
const TEXT_FONT_HEIGHT: i32 = -12;
const PET_LOGICAL_SIZE: i32 = 128;
const BUBBLE_ANCHOR_GAP: i32 = 4;

const CLASS_NAME: &[u16] = &[
    'S' as u16, 'e' as u16, 'm' as u16, 'a' as u16, 'P' as u16, 'e' as u16, 't' as u16, 'B' as u16,
    'u' as u16, 'b' as u16, 'b' as u16, 'l' as u16, 'e' as u16, 0,
];

pub struct LayeredBitmap {
    pub width: i32,
    pub height: i32,
    pub bgra: Vec<u8>,
}

pub struct BubbleWindow {
    hwnd: HWND,
}

impl BubbleWindow {
    pub unsafe fn register_class(instance: HINSTANCE) {
        let wc = WNDCLASSW {
            lpfnWndProc: Some(bubble_wnd_proc),
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
    ) -> Self {
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,
            CLASS_NAME.as_ptr(),
            CLASS_NAME.as_ptr(),
            WS_POPUP,
            x,
            y,
            BUBBLE_WIDTH,
            BUBBLE_HEIGHT,
            null_mut(),
            null_mut(),
            instance,
            coordinator as *const c_void,
        );
        Self { hwnd }
    }

    pub unsafe fn update(&self, bubbles: &[BubbleItem], pet_x: i32, pet_y: i32) {
        let Some(bitmap) = render_bubbles_bitmap(bubbles) else {
            ShowWindow(self.hwnd, SW_HIDE);
            return;
        };

        let x = pet_x + (PET_LOGICAL_SIZE - bitmap.width) / 2;
        let y = pet_y - bitmap.height - BUBBLE_ANCHOR_GAP;
        self.move_to(x, y, bitmap.width, bitmap.height);
        update_layered_bitmap(self.hwnd, bitmap.width, bitmap.height, &bitmap.bgra);
        ShowWindow(self.hwnd, SW_SHOW);
    }

    pub unsafe fn hide(&self) {
        ShowWindow(self.hwnd, SW_HIDE);
    }

    pub unsafe fn move_to(&self, x: i32, y: i32, width: i32, height: i32) {
        SetWindowPos(
            self.hwnd,
            null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

pub fn render_bubbles_bitmap(bubbles: &[BubbleItem]) -> Option<LayeredBitmap> {
    if bubbles.is_empty() {
        return None;
    }

    let visible_bubbles: Vec<_> = bubbles.iter().take(3).collect();
    let count = visible_bubbles.len() as i32;
    let bubble_width = bubble_bitmap_width(&visible_bubbles);
    let height = count * BUBBLE_HEIGHT + (count - 1) * BUBBLE_GAP;
    let mut bgra = vec![0_u8; (bubble_width * height * 4) as usize];

    for (index, bubble) in visible_bubbles.iter().enumerate() {
        let y = index as i32 * (BUBBLE_HEIGHT + BUBBLE_GAP);
        let color = match bubble.kind {
            BubbleKind::Attention => [0x00, 0x87, 0xf5, 0xea],
            BubbleKind::Info => [0x00, 0x00, 0x00, 0xd9],
        };
        fill_rounded_rect(
            &mut bgra,
            bubble_width,
            height,
            0,
            y,
            bubble_width,
            BUBBLE_HEIGHT,
            BUBBLE_RADIUS,
            color,
        );
    }

    unsafe {
        draw_bubble_text(&mut bgra, bubble_width, height, bubbles);
    }

    Some(LayeredBitmap {
        width: bubble_width,
        height,
        bgra,
    })
}

fn bubble_bitmap_width(bubbles: &[&BubbleItem]) -> i32 {
    let widest_text = bubbles
        .iter()
        .map(|bubble| estimate_text_width(&bubble.text))
        .max()
        .unwrap_or(1)
        .min(TEXT_MAX_WIDTH);
    (widest_text + TEXT_PADDING_X * 2).clamp(1, BUBBLE_MAX_WIDTH)
}

fn estimate_text_width(text: &str) -> i32 {
    let units: i32 = text
        .chars()
        .map(|ch| if ch.is_ascii() { 7 } else { 12 })
        .sum();
    units.max(1)
}

unsafe fn draw_bubble_text(bgra: &mut [u8], width: i32, height: i32, bubbles: &[BubbleItem]) {
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
    if bitmap.is_null() || bits.is_null() {
        DeleteDC(memory_dc);
        windows_sys::Win32::Graphics::Gdi::ReleaseDC(null_mut(), screen_dc);
        return;
    }

    std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
    let old_bitmap = SelectObject(memory_dc, bitmap);
    let font = CreateFontW(
        TEXT_FONT_HEIGHT,
        0,
        0,
        0,
        FW_NORMAL as i32,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        wide("Segoe UI").as_ptr(),
    );
    let old_font = SelectObject(memory_dc, font);
    SetBkMode(memory_dc, TRANSPARENT as i32);
    SetTextColor(memory_dc, 0x00ffffff);

    for (index, bubble) in bubbles.iter().take(3).enumerate() {
        let top = index as i32 * (BUBBLE_HEIGHT + BUBBLE_GAP);
        let mut rect = RECT {
            left: TEXT_PADDING_X,
            top: top + TEXT_PADDING_Y,
            right: width - TEXT_PADDING_X,
            bottom: top + BUBBLE_HEIGHT - TEXT_PADDING_Y,
        };
        let text = wide(&bubble.text);
        DrawTextW(
            memory_dc,
            text.as_ptr(),
            -1,
            &mut rect,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
        );
    }

    std::ptr::copy_nonoverlapping(bits as *const u8, bgra.as_mut_ptr(), bgra.len());
    SelectObject(memory_dc, old_font);
    SelectObject(memory_dc, old_bitmap);
    DeleteObject(font);
    DeleteObject(bitmap);
    DeleteDC(memory_dc);
    windows_sys::Win32::Graphics::Gdi::ReleaseDC(null_mut(), screen_dc);
}

unsafe fn update_layered_bitmap(hwnd: HWND, width: i32, height: i32, bgra: &[u8]) {
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
        hwnd,
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

fn fill_rounded_rect(
    bgra: &mut [u8],
    canvas_width: i32,
    canvas_height: i32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    radius: i32,
    color: [u8; 4],
) {
    for py in y..(y + height).min(canvas_height) {
        for px in x..(x + width).min(canvas_width) {
            if !inside_rounded_rect(px - x, py - y, width, height, radius) {
                continue;
            }
            let offset = ((py * canvas_width + px) * 4) as usize;
            bgra[offset..offset + 4].copy_from_slice(&color);
        }
    }
}

fn inside_rounded_rect(x: i32, y: i32, width: i32, height: i32, radius: i32) -> bool {
    let corner_x = if x < radius {
        radius
    } else if x >= width - radius {
        width - radius - 1
    } else {
        x
    };
    let corner_y = if y < radius {
        radius
    } else if y >= height - radius {
        height - radius - 1
    } else {
        y
    };
    let dx = x - corner_x;
    let dy = y - corner_y;
    dx * dx + dy * dy <= radius * radius
}

unsafe extern "system" fn bubble_wnd_proc(
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

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
