use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::{Arc, Mutex};

use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    ClientToScreen, CombineRgn, CreateRectRgn, DeleteObject, EnumDisplayMonitors, GetMonitorInfoW,
    SetWindowRgn, HDC, HMONITOR, MONITORINFO, RGN_OR,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    KillTimer, MessageBoxW, PostQuitMessage, SetTimer, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE,
    WM_DRAWITEM, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MEASUREITEM, WM_MOUSEMOVE, WM_RBUTTONUP,
};

use crate::bubble_store::BubbleStore;
use crate::bubble_window::BubbleWindow;
use crate::config::PetConfig;
use crate::focus_bridge::FocusBridge;
use crate::gif_decoder::{decode_frames_from_file, scale_frame_to_canvas, DecodedFrame};
use crate::hit_region::alpha_mask_to_runs;
use crate::hit_window::HitWindow;
use crate::protocol::PetState;
use crate::render_window::RenderWindow;
use crate::state_machine::{now_ms, StateMachine};
use crate::test_sprite::TestSprite;
use crate::tray::{draw_menu_item, measure_menu_item, MenuAction, Tray};
use crate::vscode_launcher::{launch_vscode_for_cwd, should_launch_vscode_for_focus_attempt};

const SIZE: i32 = 128;
const DRAG_THRESHOLD: i32 = 4;
const MIN_VISIBLE_SIZE: i32 = 32;
const MONITORINFOF_PRIMARY_FLAG: u32 = 1;
const ANIMATION_TIMER_ID: usize = 1;
const ANIMATION_TIMER_MS: u32 = 120;
const BUBBLE_TIMER_ID: usize = 2;
const BUBBLE_TIMER_MS: u32 = 500;

pub struct WindowCoordinator {
    render_window: Option<RenderWindow>,
    hit_window: Option<HitWindow>,
    bubble_window: Option<BubbleWindow>,
    position: POINT,
    mouse_down: Option<POINT>,
    drag_origin: Option<POINT>,
    dragging: bool,
    state_machine: Arc<Mutex<StateMachine>>,
    bubble_store: Arc<Mutex<BubbleStore>>,
    focus_bridge: Arc<FocusBridge>,
    tray: Option<Tray>,
    config_path: PathBuf,
    assets_dir: PathBuf,
    frames: HashMap<PetState, Vec<DecodedFrame>>,
    current_state: PetState,
    current_frame_index: usize,
}

impl WindowCoordinator {
    pub fn new(
        state_machine: Arc<Mutex<StateMachine>>,
        bubble_store: Arc<Mutex<BubbleStore>>,
        focus_bridge: Arc<FocusBridge>,
        config_path: PathBuf,
        assets_dir: PathBuf,
    ) -> Self {
        let config = PetConfig::load(&config_path);
        Self {
            render_window: None,
            hit_window: None,
            bubble_window: None,
            position: initial_position_from_config(&config, POINT { x: 1200, y: 160 }),
            mouse_down: None,
            drag_origin: None,
            dragging: false,
            state_machine,
            bubble_store,
            focus_bridge,
            tray: None,
            config_path,
            assets_dir,
            frames: HashMap::new(),
            current_state: PetState::Idle,
            current_frame_index: 0,
        }
    }

    pub unsafe fn create_windows(&mut self, instance: HINSTANCE, self_ptr: *mut WindowCoordinator) {
        let render_window =
            RenderWindow::create(instance, self_ptr, self.position.x, self.position.y, SIZE);
        let hit_window =
            HitWindow::create(instance, self_ptr, self.position.x, self.position.y, SIZE);
        let bubble_window =
            BubbleWindow::create(instance, self_ptr, self.position.x, self.position.y - 44);
        let sprite = self.frame_for_state(PetState::Idle, 0);

        render_window.update_bitmap(sprite.width, sprite.height, &sprite.bgra);
        self.apply_hit_region(
            hit_window.hwnd(),
            &sprite.alpha,
            sprite.width as usize,
            sprite.height as usize,
        );

        self.render_window = Some(render_window);
        self.hit_window = Some(hit_window);
        self.bubble_window = Some(bubble_window);
        self.tray = Some(Tray::install(self.notify_hwnd().unwrap()));
        self.restart_animation_timer(PetState::Idle);
        self.sync_z_order();
    }

    pub fn notify_hwnd(&self) -> Option<HWND> {
        self.hit_window.as_ref().map(HitWindow::hwnd)
    }

    pub unsafe fn on_hit_window_message(
        &mut self,
        hwnd: HWND,
        msg: u32,
        _wparam: usize,
        lparam: isize,
    ) -> isize {
        match msg {
            WM_MEASUREITEM => measure_menu_item(lparam),
            WM_DRAWITEM => draw_menu_item(lparam),
            WM_LBUTTONDOWN => {
                let point = cursor_point_from_lparam(hwnd, lparam);
                self.mouse_down = Some(point);
                self.drag_origin = Some(self.position);
                self.dragging = false;
                SetCapture(hwnd);
                0
            }
            WM_MOUSEMOVE => {
                if let (Some(start), Some(origin)) = (self.mouse_down, self.drag_origin) {
                    let current = cursor_point_from_lparam(hwnd, lparam);
                    let dx = current.x - start.x;
                    let dy = current.y - start.y;
                    if self.dragging || dx.abs() > DRAG_THRESHOLD || dy.abs() > DRAG_THRESHOLD {
                        self.dragging = true;
                        self.move_to(origin.x + dx, origin.y + dy);
                    }
                }
                0
            }
            WM_LBUTTONUP => {
                ReleaseCapture();
                let was_click = !self.dragging;
                self.mouse_down = None;
                self.drag_origin = None;
                self.dragging = false;
                if was_click {
                    self.focus_winner_or_show_probe();
                } else {
                    self.save_window_position();
                }
                0
            }
            WM_RBUTTONUP => {
                let point = cursor_point_from_lparam(hwnd, lparam);
                self.show_session_menu(Some(point));
                0
            }
            _ => windows_sys::Win32::UI::WindowsAndMessaging::DefWindowProcW(
                hwnd, msg, _wparam, lparam,
            ),
        }
    }

    pub unsafe fn on_state_changed(&mut self) {
        let snapshot = self.state_machine.lock().unwrap().snapshot(now_ms());
        self.current_state = snapshot.state;
        self.current_frame_index = 0;
        let sprite = self.frame_for_state(snapshot.state, self.current_frame_index);
        if let Some(render) = &self.render_window {
            render.update_bitmap(sprite.width, sprite.height, &sprite.bgra);
        }
        if let Some(hit) = &self.hit_window {
            self.apply_hit_region(
                hit.hwnd(),
                &sprite.alpha,
                sprite.width as usize,
                sprite.height as usize,
            );
        }
        self.restart_animation_timer(snapshot.state);
    }

    pub unsafe fn on_bubbles_changed(&mut self) {
        let bubbles = self.bubble_store.lock().unwrap().visible(now_ms());
        if let Some(bubble_window) = &self.bubble_window {
            bubble_window.update(&bubbles, self.position.x, self.position.y);
        }
        if let Some(hit) = &self.hit_window {
            if bubbles.is_empty() {
                KillTimer(hit.hwnd(), BUBBLE_TIMER_ID);
            } else {
                SetTimer(hit.hwnd(), BUBBLE_TIMER_ID, BUBBLE_TIMER_MS, None);
            }
        }
    }

    pub unsafe fn on_timer(&mut self, timer_id: usize) {
        match timer_id {
            ANIMATION_TIMER_ID => self.on_animation_timer(),
            BUBBLE_TIMER_ID => self.on_bubbles_changed(),
            _ => {}
        }
    }

    unsafe fn on_animation_timer(&mut self) {
        let frame_count = self.frames_for_state(self.current_state).len();
        if frame_count <= 1 {
            self.restart_animation_timer(self.current_state);
            return;
        }
        self.current_frame_index = (self.current_frame_index + 1) % frame_count;
        let frame = self.frame_for_state(self.current_state, self.current_frame_index);
        if let Some(render) = &self.render_window {
            render.update_bitmap(frame.width, frame.height, &frame.bgra);
        }
        if let Some(hit) = &self.hit_window {
            self.apply_hit_region(
                hit.hwnd(),
                &frame.alpha,
                frame.width as usize,
                frame.height as usize,
            );
        }
    }

    pub unsafe fn quit(&mut self) {
        if let Some(tray) = &mut self.tray {
            tray.uninstall();
        }
        if let Some(hit) = &self.hit_window {
            KillTimer(hit.hwnd(), ANIMATION_TIMER_ID);
            KillTimer(hit.hwnd(), BUBBLE_TIMER_ID);
        }
        if let Some(bubble_window) = &self.bubble_window {
            bubble_window.hide();
        }
        PostQuitMessage(0);
    }

    pub unsafe fn on_tray_callback(&mut self, lparam: isize) {
        let msg = lparam as u32;
        if msg == windows_sys::Win32::UI::WindowsAndMessaging::WM_LBUTTONUP
            || msg == windows_sys::Win32::UI::WindowsAndMessaging::WM_RBUTTONUP
        {
            self.show_session_menu(None);
        }
    }

    unsafe fn move_to(&mut self, x: i32, y: i32) {
        self.position = POINT { x, y };
        if let Some(render) = &self.render_window {
            render.move_to(x, y, SIZE);
        }
        if let Some(hit) = &self.hit_window {
            hit.move_to(x, y, SIZE);
        }
        self.on_bubbles_changed();
        self.sync_z_order();
    }

    unsafe fn sync_z_order(&self) {
        if let Some(render) = &self.render_window {
            SetWindowPos(
                render.hwnd(),
                null_mut(),
                self.position.x,
                self.position.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
        if let Some(hit) = &self.hit_window {
            SetWindowPos(
                hit.hwnd(),
                null_mut(),
                self.position.x,
                self.position.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    unsafe fn apply_hit_region(&self, hwnd: HWND, alpha: &[u8], width: usize, height: usize) {
        let region = CreateRectRgn(0, 0, 0, 0);
        for run in alpha_mask_to_runs(alpha, width, height, 16) {
            let rect_region = CreateRectRgn(run.x, run.y, run.x + run.width, run.y + 1);
            CombineRgn(region, region, rect_region, RGN_OR);
            DeleteObject(rect_region);
        }
        SetWindowRgn(hwnd, region, 1);
    }

    unsafe fn focus_winner_or_show_probe(&self) {
        let snapshot = self.state_machine.lock().unwrap().snapshot(now_ms());
        if let Some(session_id) = snapshot.winner_session_id {
            let cwd = snapshot
                .sessions
                .iter()
                .find(|session| session.session_id == session_id)
                .map(|session| session.cwd.clone());
            let had_waiter = self.focus_bridge.enqueue_focus(session_id);
            if should_launch_vscode_for_focus_attempt(had_waiter) {
                if let Some(cwd) = cwd {
                    let _ = launch_vscode_for_cwd(&cwd);
                }
            }
            return;
        }

        let title = wide("Sema Pet");
        let text = wide("Windows pet Phase 2 probe: no registered session.");
        MessageBoxW(null_mut(), text.as_ptr(), title.as_ptr(), 0);
    }

    unsafe fn show_session_menu(&self, point: Option<POINT>) {
        let Some(tray) = &self.tray else {
            return;
        };
        let sessions = self
            .state_machine
            .lock()
            .unwrap()
            .snapshot(now_ms())
            .sessions;
        match tray.show_menu(&sessions, point) {
            Some(MenuAction::FocusSession(session_id)) => {
                let cwd = sessions
                    .iter()
                    .find(|session| session.session_id == session_id)
                    .map(|session| session.cwd.clone());
                let had_waiter = self.focus_bridge.enqueue_focus(session_id);
                if should_launch_vscode_for_focus_attempt(had_waiter) {
                    if let Some(cwd) = cwd {
                        let _ = launch_vscode_for_cwd(&cwd);
                    }
                }
            }
            Some(MenuAction::Quit) => {
                PostQuitMessage(0);
            }
            None => {}
        }
    }

    fn save_window_position(&self) {
        let config = PetConfig::load(&self.config_path)
            .with_window_position(self.position.x, self.position.y);
        let _ = config.save(&self.config_path);
    }

    unsafe fn restart_animation_timer(&mut self, state: PetState) {
        let frame_count = self.frames_for_state(state).len();
        if let Some(hit) = &self.hit_window {
            KillTimer(hit.hwnd(), ANIMATION_TIMER_ID);
            if frame_count > 1 {
                SetTimer(hit.hwnd(), ANIMATION_TIMER_ID, ANIMATION_TIMER_MS, None);
            }
        }
    }

    fn frame_for_state(&mut self, state: PetState, index: usize) -> DecodedFrame {
        let frames = self.frames_for_state(state);
        frames
            .get(index.min(frames.len().saturating_sub(1)))
            .cloned()
            .unwrap_or_else(|| test_frame_for_state(state))
    }

    fn frames_for_state(&mut self, state: PetState) -> &Vec<DecodedFrame> {
        if self.frames.contains_key(&state) {
            return self.frames.get(&state).unwrap();
        }
        let path = state_asset_path(&self.assets_dir, state);
        let frames = decode_frames_from_file(&path)
            .map(|frames| {
                frames
                    .iter()
                    .map(|frame| scale_frame_to_canvas(frame, SIZE, SIZE))
                    .collect::<Vec<_>>()
            })
            .filter(|frames| !frames.is_empty())
            .unwrap_or_else(|| vec![test_frame_for_state(state)]);
        self.frames.insert(state, frames);
        self.frames.get(&state).unwrap()
    }
}

fn state_asset_path(assets_dir: &Path, state: PetState) -> PathBuf {
    assets_dir.join(match state {
        PetState::Idle => "idle.gif",
        PetState::Thinking => "thinking.gif",
        PetState::Working => "working.gif",
        PetState::Attention => "attention.gif",
        PetState::Sleeping => "sleeping.gif",
    })
}

fn test_frame_for_state(state: PetState) -> DecodedFrame {
    let sprite = TestSprite::for_state(state);
    DecodedFrame {
        width: sprite.width,
        height: sprite.height,
        bgra: sprite.bgra,
        alpha: sprite.alpha,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkArea {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

pub fn initial_position_from_config(config: &PetConfig, default: POINT) -> POINT {
    initial_position_from_config_with_work_areas(config, default, &monitor_work_areas())
}

pub fn initial_position_from_config_with_work_areas(
    config: &PetConfig,
    default: POINT,
    work_areas: &[WorkArea],
) -> POINT {
    let Some(position) = config.window_position else {
        return default;
    };
    let configured = POINT {
        x: position.x,
        y: position.y,
    };
    if work_areas.is_empty()
        || rect_has_visible_intersection(configured.x, configured.y, SIZE, SIZE, work_areas)
    {
        return configured;
    }

    default_position_for_work_area(work_areas[0], SIZE)
}

pub fn rect_has_visible_intersection(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    work_areas: &[WorkArea],
) -> bool {
    work_areas.iter().any(|area| {
        let visible_width = (x + width).min(area.right) - x.max(area.left);
        let visible_height = (y + height).min(area.bottom) - y.max(area.top);
        visible_width >= MIN_VISIBLE_SIZE && visible_height >= MIN_VISIBLE_SIZE
    })
}

pub fn default_position_for_work_area(area: WorkArea, size: i32) -> POINT {
    POINT {
        x: area.right - size - 24,
        y: area.bottom - size - 48,
    }
}

fn monitor_work_areas() -> Vec<WorkArea> {
    let mut areas: Vec<WorkArea> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            null_mut(),
            null_mut(),
            Some(enum_monitor_proc),
            &mut areas as *mut Vec<WorkArea> as LPARAM,
        );
    }
    areas
}

unsafe extern "system" fn enum_monitor_proc(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> i32 {
    let areas = &mut *(lparam as *mut Vec<WorkArea>);
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        rcWork: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        dwFlags: 0,
    };
    if GetMonitorInfoW(monitor, &mut info) != 0 {
        let area = WorkArea {
            left: info.rcWork.left,
            top: info.rcWork.top,
            right: info.rcWork.right,
            bottom: info.rcWork.bottom,
        };
        if info.dwFlags & MONITORINFOF_PRIMARY_FLAG != 0 {
            areas.insert(0, area);
        } else {
            areas.push(area);
        }
    }
    1
}

unsafe fn cursor_point_from_lparam(hwnd: HWND, lparam: isize) -> POINT {
    let x = (lparam as u32 & 0xffff) as i16 as i32;
    let y = ((lparam as u32 >> 16) & 0xffff) as i16 as i32;
    let mut point = POINT { x, y };
    ClientToScreen(hwnd, &mut point);
    point
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
