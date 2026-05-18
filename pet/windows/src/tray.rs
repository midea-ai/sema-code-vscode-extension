use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HWND, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, DrawTextW, Ellipse, FillRect, GetStockObject,
    GetSysColor, GetSysColorBrush, SelectObject, SetBkMode, SetTextColor, BITMAPINFO,
    BITMAPINFOHEADER, COLOR_HIGHLIGHT, COLOR_HIGHLIGHTTEXT, COLOR_MENU, COLOR_MENUTEXT,
    DIB_RGB_COLORS, DT_LEFT, DT_SINGLELINE, DT_VCENTER, HBITMAP, NULL_PEN, TRANSPARENT,
};
use windows_sys::Win32::UI::Controls::{DRAWITEMSTRUCT, MEASUREITEMSTRUCT, ODS_SELECTED};
use windows_sys::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreateIconIndirect, CreatePopupMenu, DestroyIcon, DestroyMenu, GetCursorPos,
    SetForegroundWindow, TrackPopupMenu, HICON, HMENU, ICONINFO, MF_GRAYED, MF_OWNERDRAW,
    MF_SEPARATOR, MF_STRING, TPM_RETURNCMD, TPM_RIGHTBUTTON,
};

use crate::protocol::PetState;
use crate::state_machine::SessionSnapshot;
use crate::window_messages::WM_APP_TRAY_CALLBACK;

const TRAY_UID: u32 = 1;
const FIRST_COMMAND_ID: u32 = 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuAction {
    FocusSession(String),
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuItemKind {
    Command(MenuAction),
    Disabled,
    Separator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub label: String,
    pub kind: MenuItemKind,
    pub state: Option<PetState>,
}

struct MenuDrawData {
    label: Vec<u16>,
    state: Option<PetState>,
}

pub struct Tray {
    hwnd: HWND,
    icon: HICON,
    installed: bool,
}

impl Tray {
    pub unsafe fn install(hwnd: HWND) -> Self {
        let icon = create_paw_icon(32);
        let mut data = notify_icon_data(hwnd, icon);
        let installed = Shell_NotifyIconW(NIM_ADD, &mut data) != 0;
        Self {
            hwnd,
            icon,
            installed,
        }
    }

    pub unsafe fn show_menu(
        &self,
        sessions: &[SessionSnapshot],
        point: Option<POINT>,
    ) -> Option<MenuAction> {
        let point = match point {
            Some(point) => point,
            None => {
                let mut point = POINT { x: 0, y: 0 };
                GetCursorPos(&mut point);
                point
            }
        };
        show_menu_for_sessions(self.hwnd, sessions, point)
    }

    pub unsafe fn uninstall(&mut self) {
        if !self.installed {
            return;
        }
        let mut data = notify_icon_data(self.hwnd, null_mut());
        Shell_NotifyIconW(NIM_DELETE, &mut data);
        self.installed = false;
        if !self.icon.is_null() {
            DestroyIcon(self.icon);
            self.icon = null_mut();
        }
    }
}

impl Drop for Tray {
    fn drop(&mut self) {
        unsafe {
            self.uninstall();
        }
    }
}

pub fn build_menu_items(sessions: &[SessionSnapshot]) -> Vec<MenuItem> {
    let mut items = Vec::new();

    if sessions.is_empty() {
        items.push(MenuItem {
            label: "No active sessions".to_string(),
            kind: MenuItemKind::Disabled,
            state: None,
        });
    } else {
        for session in sessions {
            items.push(MenuItem {
                label: format!("{} - {}", session.project_name, state_label(session.state)),
                kind: MenuItemKind::Command(MenuAction::FocusSession(session.session_id.clone())),
                state: Some(session.state),
            });
        }
    }

    items.push(MenuItem {
        label: String::new(),
        kind: MenuItemKind::Separator,
        state: None,
    });
    items.push(MenuItem {
        label: "Exit Sema Pet".to_string(),
        kind: MenuItemKind::Command(MenuAction::Quit),
        state: None,
    });
    items
}

pub unsafe fn measure_menu_item(lparam: isize) -> isize {
    let measure = &mut *(lparam as *mut MEASUREITEMSTRUCT);
    let data = measure.itemData as *const MenuDrawData;
    if data.is_null() {
        return 0;
    }
    let label_len = (*data).label.len().saturating_sub(1) as u32;
    measure.itemHeight = 24;
    measure.itemWidth = 34 + label_len.saturating_mul(7).max(80);
    1
}

pub unsafe fn draw_menu_item(lparam: isize) -> isize {
    let draw = &*(lparam as *const DRAWITEMSTRUCT);
    let data = draw.itemData as *const MenuDrawData;
    if data.is_null() {
        return 0;
    }

    let selected = draw.itemState & ODS_SELECTED != 0;
    let background = if selected {
        COLOR_HIGHLIGHT
    } else {
        COLOR_MENU
    };
    FillRect(draw.hDC, &draw.rcItem, GetSysColorBrush(background));

    if let Some(state) = (*data).state {
        let dot_color = state_color(state);
        let brush = windows_sys::Win32::Graphics::Gdi::CreateSolidBrush(dot_color);
        let old_brush = SelectObject(draw.hDC, brush);
        let old_pen = SelectObject(draw.hDC, GetStockObject(NULL_PEN));
        let center_y = draw.rcItem.top + (draw.rcItem.bottom - draw.rcItem.top) / 2;
        let left = draw.rcItem.left + 11;
        Ellipse(draw.hDC, left, center_y - 4, left + 8, center_y + 4);
        SelectObject(draw.hDC, old_pen);
        SelectObject(draw.hDC, old_brush);
        DeleteObject(brush);
    }

    SetBkMode(draw.hDC, TRANSPARENT as i32);
    let text_color = if selected {
        system_color_ref(COLOR_HIGHLIGHTTEXT)
    } else {
        system_color_ref(COLOR_MENUTEXT)
    };
    SetTextColor(draw.hDC, text_color);

    let mut text_rect = draw.rcItem;
    text_rect.left += 28;
    text_rect.right -= 10;
    DrawTextW(
        draw.hDC,
        (*data).label.as_ptr(),
        -1,
        &mut text_rect,
        DT_LEFT | DT_SINGLELINE | DT_VCENTER,
    );
    1
}

pub fn paint_paw_icon_bgra(pixels: &mut [u8], size: i32) {
    pixels.fill(0);
    let color = [0x33, 0x99, 0xff, 0xff];
    fill_circle(
        pixels,
        size,
        size as f32 * 0.50,
        size as f32 * 0.62,
        size as f32 * 0.22,
        color,
    );
    fill_circle(
        pixels,
        size,
        size as f32 * 0.30,
        size as f32 * 0.35,
        size as f32 * 0.11,
        color,
    );
    fill_circle(
        pixels,
        size,
        size as f32 * 0.43,
        size as f32 * 0.25,
        size as f32 * 0.10,
        color,
    );
    fill_circle(
        pixels,
        size,
        size as f32 * 0.58,
        size as f32 * 0.25,
        size as f32 * 0.10,
        color,
    );
    fill_circle(
        pixels,
        size,
        size as f32 * 0.71,
        size as f32 * 0.35,
        size as f32 * 0.11,
        color,
    );
}

unsafe fn show_menu_for_sessions(
    hwnd: HWND,
    sessions: &[SessionSnapshot],
    point: POINT,
) -> Option<MenuAction> {
    let menu = CreatePopupMenu();
    if menu.is_null() {
        return None;
    }

    let items = build_menu_items(sessions);
    let mut command_actions = Vec::new();
    let mut draw_data: Vec<Box<MenuDrawData>> = Vec::new();
    for item in &items {
        match &item.kind {
            MenuItemKind::Command(action) => {
                let command_id = FIRST_COMMAND_ID + command_actions.len() as u32;
                if item.state.is_some() {
                    draw_data.push(Box::new(MenuDrawData {
                        label: wide(&item.label),
                        state: item.state,
                    }));
                    let data = draw_data.last().unwrap().as_ref() as *const MenuDrawData;
                    AppendMenuW(menu, MF_OWNERDRAW, command_id as usize, data as *const u16);
                } else {
                    let label = wide(&item.label);
                    AppendMenuW(menu, MF_STRING, command_id as usize, label.as_ptr());
                }
                command_actions.push(action.clone());
            }
            MenuItemKind::Disabled => {
                let label = wide(&item.label);
                AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, label.as_ptr());
            }
            MenuItemKind::Separator => {
                AppendMenuW(menu, MF_SEPARATOR, 0, null_mut());
            }
        }
    }

    SetForegroundWindow(hwnd);
    let command = TrackPopupMenu(
        menu,
        TPM_RETURNCMD | TPM_RIGHTBUTTON,
        point.x,
        point.y,
        0,
        hwnd,
        null_mut(),
    );
    DestroyMenu(menu as HMENU);

    if command == 0 {
        return None;
    }
    command_actions
        .get(command.saturating_sub(FIRST_COMMAND_ID as i32) as usize)
        .cloned()
}

fn notify_icon_data(hwnd: HWND, icon: HICON) -> NOTIFYICONDATAW {
    let mut data: NOTIFYICONDATAW = unsafe { zeroed() };
    data.cbSize = size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = hwnd;
    data.uID = TRAY_UID;
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    data.uCallbackMessage = WM_APP_TRAY_CALLBACK;
    data.hIcon = icon;

    let tip = wide("Sema Pet");
    for (index, ch) in tip.into_iter().take(data.szTip.len()).enumerate() {
        data.szTip[index] = ch;
    }

    data
}

unsafe fn create_paw_icon(size: i32) -> HICON {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            ..zeroed()
        },
        ..zeroed()
    };
    let mut bits: *mut c_void = null_mut();
    let color_bitmap = CreateDIBSection(
        null_mut(),
        &mut info,
        DIB_RGB_COLORS,
        &mut bits,
        null_mut(),
        0,
    );
    if color_bitmap.is_null() || bits.is_null() {
        return null_mut();
    }

    let buffer = std::slice::from_raw_parts_mut(bits as *mut u8, (size * size * 4) as usize);
    paint_paw_icon_bgra(buffer, size);

    let mask_bitmap = CreateBitmap(size, size, 1, 1, null_mut());
    if mask_bitmap.is_null() {
        DeleteObject(color_bitmap);
        return null_mut();
    }

    let icon_info = ICONINFO {
        fIcon: 1,
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask_bitmap,
        hbmColor: color_bitmap,
    };
    let icon = CreateIconIndirect(&icon_info);
    DeleteObject(color_bitmap as HBITMAP);
    DeleteObject(mask_bitmap as HBITMAP);
    icon
}

fn fill_circle(pixels: &mut [u8], size: i32, cx: f32, cy: f32, radius: f32, color: [u8; 4]) {
    let radius_sq = radius * radius;
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy > radius_sq {
                continue;
            }
            let offset = ((y * size + x) * 4) as usize;
            pixels[offset..offset + 4].copy_from_slice(&color);
        }
    }
}

fn state_color(state: PetState) -> u32 {
    match state {
        PetState::Attention => color_ref(0xff, 0x9f, 0x1c),
        PetState::Working => color_ref(0x31, 0xd1, 0x58),
        PetState::Thinking => color_ref(0x3b, 0x82, 0xf6),
        PetState::Idle | PetState::Sleeping => color_ref(0x9c, 0xa3, 0xaf),
    }
}

fn color_ref(red: u8, green: u8, blue: u8) -> u32 {
    red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
}

unsafe fn system_color_ref(index: i32) -> u32 {
    GetSysColor(index)
}

fn state_label(state: PetState) -> &'static str {
    match state {
        PetState::Idle => "idle",
        PetState::Thinking => "thinking",
        PetState::Working => "working",
        PetState::Attention => "attention",
        PetState::Sleeping => "sleeping",
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
