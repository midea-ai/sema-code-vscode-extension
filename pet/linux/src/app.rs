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
use crate::bubble_window::BubbleWindow;
use crate::config::PetConfig;
use crate::focus_bridge::FocusBridge;
use crate::gif_animation::GifAnimation;
use crate::messages::UiMessage;
use crate::pet_window::PetWindow;
use crate::process::is_process_alive;
use crate::protocol::PetState;
use crate::state_machine::{now_ms, SessionSnapshot, StateMachine};
use crate::tray::{build_menu_entries, MenuEntry, PetTray};
use crate::vscode_launcher::{launch_vscode_for_cwd, should_launch_vscode_for_focus_attempt};

const SIZE: i32 = 128;
const DRAG_THRESHOLD: i32 = 4;
const MIN_VISIBLE_SIZE: i32 = 32;
const BUBBLE_SWEEP_MS: u64 = 500;
const STALE_SWEEP_SECS: u64 = 30;

/// 协调器：持有桌宠窗 / 气泡窗 / 托盘句柄，把 HTTP、定时器、输入事件
/// 汇集到一处处理。对应 Windows 端的 WindowCoordinator。
pub struct App {
    pet: PetWindow,
    bubble: BubbleWindow,
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
            bubble: BubbleWindow::new(),
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
            3 => App::show_menu(app),
            _ => {}
        }
    }

    fn on_motion(app: &Rc<RefCell<App>>, event: &gdk::EventMotion) {
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

    fn show_menu(app: &Rc<RefCell<App>>) {
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

        let menu = gtk::Menu::new();
        for entry in build_menu_entries(&sessions) {
            match entry {
                MenuEntry::Item { label, action } => {
                    let item = gtk::MenuItem::with_label(&label);
                    let ui_tx = ui_tx.clone();
                    item.connect_activate(move |_| {
                        let _ = ui_tx.send(action.to_message());
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
        menu.popup_at_pointer(None);
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
        let (x, y) = a.position;
        a.bubble.update(&bubbles, x, y);
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

    fn quit(app: &Rc<RefCell<App>>) {
        app.borrow().bubble.hide();
        gtk::main_quit();
    }

    // ---- 聚焦 ----

    fn focus_winner(app: &Rc<RefCell<App>>) {
        let snapshot = {
            let a = app.borrow();
            a.state_machine.lock().unwrap().snapshot(now_ms())
        };
        if let Some(session_id) = snapshot.winner_session_id {
            App::do_focus(app, &session_id, &snapshot.sessions);
        }
    }

    fn focus_session_by_id(app: &Rc<RefCell<App>>, session_id: &str) {
        let sessions = {
            let a = app.borrow();
            a.state_machine
                .lock()
                .unwrap()
                .snapshot(now_ms())
                .sessions
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
        let had_waiter = focus_bridge.enqueue_focus(session_id.to_string());
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
        self.bubble.update(&self.last_bubbles, x, y);
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
                || rect_has_visible_intersection(position.x, position.y, SIZE, SIZE, &work_areas)
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
    (area.right - SIZE - 24, area.bottom - SIZE - 48)
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
