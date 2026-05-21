use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gdk::prelude::*;
use gdk_pixbuf::{Colorspace, Pixbuf, PixbufAnimation};
use gtk::prelude::*;

use crate::assets::state_asset_path;
use crate::bubble_store::{BubbleItem, BubbleStore};
use crate::config::PetConfig;
use crate::focus_bridge::FocusBridge;
use crate::gif_animation::GifAnimation;
use crate::messages::UiMessage;
use crate::pet_window::{PetWindow, CANVAS_HEIGHT, CANVAS_WIDTH, PET_AREA};
use crate::process::is_process_alive;
use crate::protocol::PetState;
use crate::state_machine::{now_ms, SessionSnapshot, StateMachine};
use crate::tray::{build_menu_entries, MenuEntry, PetTray};
use crate::vscode_launcher::{launch_vscode_for_cwd, should_launch_vscode_for_focus_attempt};
use crate::x11_activate::raise_window_for_cwd;

const DRAG_THRESHOLD: i32 = 4;
const MIN_VISIBLE_SIZE: i32 = 32;
const BUBBLE_SWEEP_MS: u64 = 500;
const STALE_SWEEP_SECS: u64 = 30;
const SLEEP_TICK_SECS: u64 = 30;

/// 协调器：持有桌宠窗 / 托盘句柄，把 HTTP、定时器、输入事件
/// 汇集到一处处理。对应 Windows 端的 WindowCoordinator。
/// 气泡画在桌宠窗内部（Wayland 协议不允许客户端定位独立 toplevel）。
pub struct App {
    pet: PetWindow,
    position: (i32, i32),
    mouse_down: Option<(f64, f64)>,
    drag_origin: Option<(i32, i32)>,
    dragging: bool,
    state_machine: Arc<Mutex<StateMachine>>,
    bubble_store: Arc<Mutex<BubbleStore>>,
    focus_bridge: Arc<FocusBridge>,
    tray: Option<ksni::Handle<PetTray>>,
    ui_tx: glib::Sender<UiMessage>,
    config_path: PathBuf,
    assets_dir: PathBuf,
    animations: HashMap<PetState, PixbufAnimation>,
    current_anim: Option<GifAnimation>,
    current_state: PetState,
    anim_generation: u64,
    last_bubbles: Vec<BubbleItem>,
    /// 当前打开的右键菜单。强制单例：每次 show_menu 都会先 popdown 旧的，
    /// 避免多次右键累积出 N 个面板。
    current_menu: Option<gtk::Menu>,
    /// 菜单打开期间铺在全屏的透明点击遮罩。GtkMenu 的 seat grab 在本机 WM 下
    /// 不覆盖整屏（菜单外、桌面上的点击关不了菜单），用它接管那些点击。
    menu_backdrop: Option<gtk::Window>,
}

/// 装配并启动桌宠：建窗口、起托盘、接线信号与定时器。调用方随后跑 `gtk::main()`。
pub fn start(
    state_machine: Arc<Mutex<StateMachine>>,
    bubble_store: Arc<Mutex<BubbleStore>>,
    focus_bridge: Arc<FocusBridge>,
    config_path: PathBuf,
    assets_dir: PathBuf,
    ui_tx: glib::Sender<UiMessage>,
    ui_rx: glib::Receiver<UiMessage>,
) {
    let app = App::new(
        state_machine,
        bubble_store,
        focus_bridge,
        config_path,
        assets_dir,
        ui_tx.clone(),
    );
    let app = Rc::new(RefCell::new(app));

    // 显示桌宠窗口（X11 下 move 在 show 前后各做一次更可靠）。
    {
        let app_ref = app.borrow();
        let (x, y) = app_ref.position;
        app_ref.pet.widget().move_(x, y);
        app_ref.pet.widget().show();
        app_ref.pet.widget().move_(x, y);
    }
    app.borrow_mut().set_state(PetState::Idle);

    // 托盘：失败（无 D-Bus / headless）不致命，右键桌宠仍可出菜单。
    {
        let sessions = app
            .borrow()
            .state_machine
            .lock()
            .unwrap()
            .snapshot(now_ms())
            .sessions;
        let handle = spawn_tray(sessions, ui_tx);
        app.borrow_mut().tray = handle;
    }

    wire_pet_input(&app);

    // HTTP / 托盘线程的消息泵。
    {
        let app = Rc::clone(&app);
        ui_rx.attach(None, move |message| {
            App::handle_ui_message(&app, message);
            glib::ControlFlow::Continue
        });
    }

    // 气泡过期清扫。
    {
        let app = Rc::clone(&app);
        glib::timeout_add_local(Duration::from_millis(BUBBLE_SWEEP_MS), move || {
            App::on_bubbles_changed(&app);
            glib::ControlFlow::Continue
        });
    }

    // 孤儿会话清扫（VS Code 崩溃未 unregister）。
    {
        let app = Rc::clone(&app);
        glib::timeout_add_local(Duration::from_secs(STALE_SWEEP_SECS), move || {
            App::on_stale_sweep(&app);
            glib::ControlFlow::Continue
        });
    }

    // idle → sleeping 自动切换：周期性重算状态，对齐 mac StateMachine.startSleepTimer。
    // 全部会话 idle 满阈值（state_machine SLEEPING_AFTER_MS）后，无需任何事件即可切到
    // sleeping —— on_state_changed 仅在状态真正变化时才切动画，未变时只刷新托盘，开销很低。
    {
        let app = Rc::clone(&app);
        glib::timeout_add_local(Duration::from_secs(SLEEP_TICK_SECS), move || {
            App::on_state_changed(&app);
            glib::ControlFlow::Continue
        });
    }

    App::restart_anim(&app);
}

fn wire_pet_input(app: &Rc<RefCell<App>>) {
    let window = app.borrow().pet.widget().clone();

    {
        let app = Rc::clone(app);
        window.connect_button_press_event(move |_w, event| {
            App::on_button_press(&app, event);
            glib::Propagation::Stop
        });
    }
    {
        let app = Rc::clone(app);
        window.connect_motion_notify_event(move |_w, event| {
            App::on_motion(&app, event);
            glib::Propagation::Stop
        });
    }
    {
        let app = Rc::clone(app);
        window.connect_button_release_event(move |_w, event| {
            App::on_button_release(&app, event);
            glib::Propagation::Stop
        });
    }
    // 兜底：手动 move_() 后 X server 会回发 ConfigureNotify，同步内部 position
    // 防止外界（合成器/工具）异步重定位时本地 position 漂移。保存交给 button_release。
    {
        let app = Rc::clone(app);
        window.connect_configure_event(move |_w, event| {
            App::on_configure(&app, event);
            false
        });
    }
}

fn spawn_tray(
    sessions: Vec<SessionSnapshot>,
    tx: glib::Sender<UiMessage>,
) -> Option<ksni::Handle<PetTray>> {
    let service = ksni::TrayService::new(PetTray { sessions, tx });
    let handle = service.handle();
    let _ = service.spawn();
    Some(handle)
}

impl App {
    fn new(
        state_machine: Arc<Mutex<StateMachine>>,
        bubble_store: Arc<Mutex<BubbleStore>>,
        focus_bridge: Arc<FocusBridge>,
        config_path: PathBuf,
        assets_dir: PathBuf,
        ui_tx: glib::Sender<UiMessage>,
    ) -> App {
        let config = PetConfig::load(&config_path);
        let position = initial_position(&config);
        App {
            pet: PetWindow::new(),
            position,
            mouse_down: None,
            drag_origin: None,
            dragging: false,
            state_machine,
            bubble_store,
            focus_bridge,
            tray: None,
            ui_tx,
            config_path,
            assets_dir,
            animations: HashMap::new(),
            current_anim: None,
            current_state: PetState::Idle,
            anim_generation: 0,
            last_bubbles: Vec::new(),
            current_menu: None,
            menu_backdrop: None,
        }
    }

    // ---- 输入事件 ----

    fn on_button_press(app: &Rc<RefCell<App>>, event: &gdk::EventButton) {
        match event.button() {
            1 => {
                let mut a = app.borrow_mut();
                let position = a.position;
                a.mouse_down = Some(event.root());
                a.drag_origin = Some(position);
                a.dragging = false;
            }
            3 => App::show_menu(app, event),
            _ => {}
        }
    }

    fn on_motion(app: &Rc<RefCell<App>>, event: &gdk::EventMotion) {
        // X11 下用手动 move_ 而非 begin_move_drag：begin_move_drag 会让 WM
        // grab 鼠标，期间 motion / button_release 都收不到，状态机难对齐；
        // 主进程强制 GDK_BACKEND=x11，X11 协议本就允许 client 自行 move toplevel。
        let mut a = app.borrow_mut();
        let (Some(start), Some(origin)) = (a.mouse_down, a.drag_origin) else {
            return;
        };
        let (root_x, root_y) = event.root();
        let dx = (root_x - start.0).round() as i32;
        let dy = (root_y - start.1).round() as i32;
        if a.dragging || dx.abs() > DRAG_THRESHOLD || dy.abs() > DRAG_THRESHOLD {
            a.dragging = true;
            a.move_to(origin.0 + dx, origin.1 + dy);
        }
    }

    fn on_button_release(app: &Rc<RefCell<App>>, event: &gdk::EventButton) {
        if event.button() != 1 {
            return;
        }
        let was_click = {
            let mut a = app.borrow_mut();
            let was_click = a.mouse_down.is_some() && !a.dragging;
            a.mouse_down = None;
            a.drag_origin = None;
            a.dragging = false;
            was_click
        };
        if was_click {
            App::focus_winner(app);
        } else {
            app.borrow().save_window_position();
        }
    }

    fn on_configure(app: &Rc<RefCell<App>>, event: &gdk::EventConfigure) {
        let (x, y) = event.position();
        let mut a = app.borrow_mut();
        if a.position != (x, y) {
            a.position = (x, y);
        }
    }

    fn show_menu(app: &Rc<RefCell<App>>, event: &gdk::EventButton) {
        // 1) 单例：旧菜单 + 旧遮罩先收掉，避免连续右键叠出多个面板。
        {
            let mut a = app.borrow_mut();
            if let Some(old) = a.current_menu.take() {
                old.popdown();
            }
            if let Some(bd) = a.menu_backdrop.take() {
                bd.close();
            }
        }

        let (sessions, ui_tx) = {
            let a = app.borrow();
            let sessions = a
                .state_machine
                .lock()
                .unwrap()
                .snapshot(now_ms())
                .sessions;
            (sessions, a.ui_tx.clone())
        };

        // 2) gtk::Menu：对齐 mac 的 NSMenu.popUp，GTK 自管 ESC / 键盘导航 / item 点击。
        let menu = gtk::Menu::new();
        for entry in build_menu_entries(&sessions) {
            match entry {
                MenuEntry::Item { label, action } => {
                    let item = gtk::MenuItem::with_label(&label);
                    let tx = ui_tx.clone();
                    item.connect_activate(move |_| {
                        let _ = tx.send(action.to_message());
                    });
                    menu.append(&item);
                }
                MenuEntry::Disabled(label) => {
                    let item = gtk::MenuItem::with_label(&label);
                    item.set_sensitive(false);
                    menu.append(&item);
                }
                MenuEntry::Separator => {
                    menu.append(&gtk::SeparatorMenuItem::new());
                }
            }
        }
        menu.show_all();

        // 3) 全屏透明遮罩接管「菜单外」的点击。GtkMenu 的 seat grab 在本机 WM 下
        //    不覆盖整屏：点小猫能关（pet 主窗本进程收事件→GTK 关菜单），但点桌面
        //    其他位置关不掉（那些点击不进本进程事件队列）。遮罩铺满全屏、置顶且
        //    透明，吃下这些点击并关菜单。点击落在遮罩 = 菜单外 = 关闭。
        let backdrop = build_menu_backdrop();
        {
            let menu = menu.clone();
            backdrop.connect_button_press_event(move |_w, _e| {
                menu.popdown();
                glib::Propagation::Stop
            });
        }
        backdrop.show();

        // selection-done 覆盖「点 item / 点遮罩 / 点小猫 / ESC」所有关闭路径,
        // 统一收遮罩 + 清状态。
        {
            let app = Rc::clone(app);
            let backdrop = backdrop.clone();
            menu.connect_selection_done(move |_| {
                backdrop.close();
                let mut a = app.borrow_mut();
                a.current_menu = None;
                a.menu_backdrop = None;
            });
        }

        // 遮罩先 show、菜单后 popup：两者都是 override-redirect 窗口，按 map 顺序
        // 堆叠 → 菜单稳定盖在遮罩之上，菜单项正常可点。
        menu.popup_at_pointer(Some(event));

        let mut a = app.borrow_mut();
        a.current_menu = Some(menu);
        a.menu_backdrop = Some(backdrop);
    }

    // ---- UiMessage 分发 ----

    fn handle_ui_message(app: &Rc<RefCell<App>>, message: UiMessage) {
        match message {
            UiMessage::StateChanged => App::on_state_changed(app),
            UiMessage::BubblesChanged => App::on_bubbles_changed(app),
            UiMessage::FocusSession(session_id) => App::focus_session_by_id(app, &session_id),
            UiMessage::Quit => App::quit(app),
        }
    }

    fn on_state_changed(app: &Rc<RefCell<App>>) {
        let (changed, sessions) = {
            let mut a = app.borrow_mut();
            let snapshot = a.state_machine.lock().unwrap().snapshot(now_ms());
            let changed = snapshot.state != a.current_state;
            if changed {
                a.set_state(snapshot.state);
            }
            (changed, snapshot.sessions)
        };
        app.borrow().update_tray(&sessions);
        if changed {
            App::restart_anim(app);
        }
    }

    fn on_bubbles_changed(app: &Rc<RefCell<App>>) {
        let mut a = app.borrow_mut();
        let bubbles = a.bubble_store.lock().unwrap().visible(now_ms());
        if a.last_bubbles == bubbles {
            return;
        }
        a.last_bubbles = bubbles.clone();
        a.pet.show_bubbles(&bubbles);
    }

    fn on_stale_sweep(app: &Rc<RefCell<App>>) {
        let (removed, empty) = {
            let a = app.borrow();
            let mut machine = a.state_machine.lock().unwrap();
            let removed = machine.sweep_stale(is_process_alive);
            let empty = machine.is_empty();
            (removed, empty)
        };
        if removed.is_empty() {
            return;
        }
        {
            let a = app.borrow();
            let mut bubbles = a.bubble_store.lock().unwrap();
            for session_id in &removed {
                bubbles.clear_sticky_for_session(session_id);
            }
        }
        App::on_state_changed(app);
        App::on_bubbles_changed(app);
        if empty {
            App::quit(app);
        }
    }

    fn quit(_app: &Rc<RefCell<App>>) {
        gtk::main_quit();
    }

    // ---- 聚焦 ----

    fn focus_winner(app: &Rc<RefCell<App>>) {
        let snapshot = {
            let a = app.borrow();
            let guard = a.state_machine.lock().unwrap();
            guard.snapshot(now_ms())
        };
        if let Some(session_id) = snapshot.winner_session_id {
            App::do_focus(app, &session_id, &snapshot.sessions);
        }
    }

    fn focus_session_by_id(app: &Rc<RefCell<App>>, session_id: &str) {
        let sessions = {
            let a = app.borrow();
            let guard = a.state_machine.lock().unwrap();
            guard.snapshot(now_ms()).sessions
        };
        App::do_focus(app, session_id, &sessions);
    }

    fn do_focus(app: &Rc<RefCell<App>>, session_id: &str, sessions: &[SessionSnapshot]) {
        let (focus_bridge, cwd) = {
            let a = app.borrow();
            let cwd = sessions
                .iter()
                .find(|session| session.session_id == session_id)
                .map(|session| session.cwd.clone());
            (Arc::clone(&a.focus_bridge), cwd)
        };
        // 与 macOS 行为对齐：三件套同时做。
        //   1) X11 _NET_ACTIVE_WINDOW 把目标窗口 raise 并取消最小化（弥补 Linux `code` CLI
        //      不会 raise 已开窗口的行为差异）。命中失败安静回退。
        //   2) spawn `code <cwd>`：负责 VS Code 没在跑时拉起新实例。
        //   3) 发 focus 命令：通知扩展端 focus 编辑器组/侧栏。
        let had_waiter = focus_bridge.enqueue_focus(session_id.to_string());
        if let Some(cwd) = cwd.as_deref() {
            let _ = raise_window_for_cwd(cwd);
        }
        if should_launch_vscode_for_focus_attempt(had_waiter) {
            if let Some(cwd) = cwd {
                let _ = launch_vscode_for_cwd(&cwd);
            }
        }
    }

    // ---- 动画定时器（按 GIF 帧延时自调度，用 generation 作废旧链）----

    fn restart_anim(app: &Rc<RefCell<App>>) {
        let generation = {
            let mut a = app.borrow_mut();
            a.anim_generation = a.anim_generation.wrapping_add(1);
            a.anim_generation
        };
        App::schedule_anim_tick(app, generation);
    }

    fn schedule_anim_tick(app: &Rc<RefCell<App>>, generation: u64) {
        let delay = {
            let a = app.borrow();
            if a.anim_generation != generation {
                return;
            }
            match a.current_frame_delay() {
                Some(delay) => delay,
                None => return,
            }
        };
        let app = Rc::clone(app);
        glib::timeout_add_local_once(delay, move || {
            {
                let mut a = app.borrow_mut();
                if a.anim_generation != generation {
                    return;
                }
                a.advance_frame();
            }
            App::schedule_anim_tick(&app, generation);
        });
    }

    // ---- &mut self 状态操作 ----

    fn move_to(&mut self, x: i32, y: i32) {
        self.position = (x, y);
        self.pet.widget().move_(x, y);
    }

    fn set_state(&mut self, state: PetState) {
        self.current_state = state;
        let animation = self.build_animation(state);
        self.pet.show_frame(animation.current());
        self.current_anim = Some(animation);
    }

    fn build_animation(&mut self, state: PetState) -> GifAnimation {
        if let Some(animation) = self.animations.get(&state) {
            return GifAnimation::from_animation(animation);
        }
        match PixbufAnimation::from_file(state_asset_path(&self.assets_dir, state)) {
            Ok(animation) => {
                let gif = GifAnimation::from_animation(&animation);
                self.animations.insert(state, animation);
                gif
            }
            Err(_) => GifAnimation::from_pixbuf(&fallback_pixbuf(state)),
        }
    }

    fn advance_frame(&mut self) {
        let changed = match self.current_anim.as_mut() {
            Some(animation) => animation.advance(),
            None => false,
        };
        if changed {
            if let Some(animation) = self.current_anim.as_ref() {
                self.pet.show_frame(animation.current());
            }
        }
    }

    fn current_frame_delay(&self) -> Option<Duration> {
        self.current_anim
            .as_ref()
            .and_then(|animation| animation.frame_delay())
    }

    fn update_tray(&self, sessions: &[SessionSnapshot]) {
        if let Some(handle) = self.tray.as_ref() {
            let sessions = sessions.to_vec();
            handle.update(move |tray| {
                tray.sessions = sessions.clone();
            });
        }
    }

    fn save_window_position(&self) {
        let config = PetConfig::load(&self.config_path)
            .with_window_position(self.position.0, self.position.1);
        let _ = config.save(&self.config_path);
    }
}

/// 菜单的全屏点击遮罩：透明、置顶、不抢焦点，铺满所有显示器的并集区域。
/// 仅用于捕获「菜单外」的点击来关闭菜单（见 show_menu）。
fn build_menu_backdrop() -> gtk::Window {
    let backdrop = gtk::Window::new(gtk::WindowType::Popup);
    backdrop.set_decorated(false);
    backdrop.set_resizable(false);
    backdrop.set_skip_taskbar_hint(true);
    backdrop.set_skip_pager_hint(true);
    backdrop.set_keep_above(true);
    backdrop.set_accept_focus(false);
    backdrop.set_app_paintable(true);
    if let Some(screen) = gdk::Screen::default() {
        if let Some(rgba) = screen.rgba_visual() {
            backdrop.set_visual(Some(&rgba));
        }
    }
    // 全透明绘制：用户无感，只接收点击。
    backdrop.connect_draw(|_w, cr| {
        cr.set_operator(cairo::Operator::Source);
        cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
        let _ = cr.paint();
        glib::Propagation::Proceed
    });
    backdrop.add_events(gdk::EventMask::BUTTON_PRESS_MASK);

    let (x, y, w, h) = all_monitors_bounds();
    backdrop.set_default_size(w, h);
    backdrop.move_(x, y);
    backdrop.resize(w, h);
    backdrop
}

/// 所有显示器几何（含任务栏区域）的并集外接矩形：(x, y, width, height)。
/// 遮罩要盖住整屏，所以用 geometry 而非 workarea。
fn all_monitors_bounds() -> (i32, i32, i32, i32) {
    let Some(display) = gdk::Display::default() else {
        return (0, 0, 1920, 1080);
    };
    let (mut min_x, mut min_y) = (i32::MAX, i32::MAX);
    let (mut max_x, mut max_y) = (i32::MIN, i32::MIN);
    for index in 0..display.n_monitors() {
        let Some(monitor) = display.monitor(index) else {
            continue;
        };
        let geo = monitor.geometry();
        min_x = min_x.min(geo.x());
        min_y = min_y.min(geo.y());
        max_x = max_x.max(geo.x() + geo.width());
        max_y = max_y.max(geo.y() + geo.height());
    }
    if min_x == i32::MAX {
        return (0, 0, 1920, 1080);
    }
    (min_x, min_y, max_x - min_x, max_y - min_y)
}

fn fallback_pixbuf(state: PetState) -> Pixbuf {
    let pixbuf = Pixbuf::new(Colorspace::Rgb, true, 8, 96, 96)
        .expect("failed to allocate fallback pixbuf");
    let rgba = match state {
        PetState::Attention => 0xff9f1c_ff,
        PetState::Working => 0x31d158_ff,
        PetState::Thinking => 0x3b82f6_ff,
        PetState::Idle => 0x9ca3af_ff,
        PetState::Sleeping => 0x6b7280_ff,
    };
    pixbuf.fill(rgba);
    pixbuf
}

// ---- 屏幕工作区与初始定位（纯函数移植自 Windows 端）----

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WorkArea {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn initial_position(config: &PetConfig) -> (i32, i32) {
    let work_areas = monitor_work_areas();
    let fallback = work_areas
        .first()
        .map(|area| default_position_for_work_area(*area))
        .unwrap_or((1200, 160));

    match config.window_position {
        Some(position) => {
            if work_areas.is_empty()
                || rect_has_visible_intersection(
                    position.x,
                    position.y,
                    CANVAS_WIDTH,
                    CANVAS_HEIGHT,
                    &work_areas,
                )
            {
                (position.x, position.y)
            } else {
                fallback
            }
        }
        None => fallback,
    }
}

fn rect_has_visible_intersection(
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

fn default_position_for_work_area(area: WorkArea) -> (i32, i32) {
    // 让桌宠（不是画布）右下角距工作区右下 (24, 48)，与原 128 画布行为视觉一致。
    // 桌宠在画布右下角的相对位置：水平居中 + 垂直贴底。
    let pet_right_in_canvas = (CANVAS_WIDTH + PET_AREA) / 2;
    let pet_bottom_in_canvas = CANVAS_HEIGHT;
    (
        area.right - 24 - pet_right_in_canvas,
        area.bottom - 48 - pet_bottom_in_canvas,
    )
}

fn monitor_work_areas() -> Vec<WorkArea> {
    let mut areas: Vec<WorkArea> = Vec::new();
    let Some(display) = gdk::Display::default() else {
        return areas;
    };
    for index in 0..display.n_monitors() {
        let Some(monitor) = display.monitor(index) else {
            continue;
        };
        let rect = monitor.workarea();
        let area = WorkArea {
            left: rect.x(),
            top: rect.y(),
            right: rect.x() + rect.width(),
            bottom: rect.y() + rect.height(),
        };
        if monitor.is_primary() {
            areas.insert(0, area);
        } else {
            areas.push(area);
        }
    }
    areas
}
