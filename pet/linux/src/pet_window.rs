use std::cell::RefCell;
use std::rc::Rc;

use gdk::prelude::*;
use gdk_pixbuf::Pixbuf;
use gtk::prelude::*;

use crate::bubble_store::{BubbleItem, BubbleKind};
use crate::gif_animation::CANVAS;
use crate::hit_region::alpha_mask_to_runs;
use crate::protocol::SAY_MAX_VISIBLE;

/// alpha 命中阈值：> 16 视为不透明、可点击；其余区域点击穿透到背后窗口。
const HIT_THRESHOLD: u8 = 16;

/// 桌宠像素区：128×128，居中绘制 GIF 帧。
pub const PET_AREA: i32 = CANVAS;
const BUBBLE_HEIGHT: i32 = 26;
const BUBBLE_GAP: i32 = 4;
const BUBBLE_RADIUS: f64 = 8.0;
const BUBBLE_ANCHOR_GAP: i32 = 4;
const TEXT_PADDING_X: i32 = 10;
const TEXT_MAX_WIDTH: i32 = 220;
const BUBBLE_MAX_WIDTH: i32 = 240;
const MAX_BUBBLES: i32 = SAY_MAX_VISIBLE as i32;
/// 气泡区高度 = SAY_MAX_VISIBLE 条气泡 + 间隔 + 与桌宠的 anchor gap。
const BUBBLE_AREA_HEIGHT: i32 =
    MAX_BUBBLES * BUBBLE_HEIGHT + (MAX_BUBBLES - 1) * BUBBLE_GAP + BUBBLE_ANCHOR_GAP;
/// 整窗画布：宽容纳最宽气泡，高 = 气泡区 + 桌宠区。
pub const CANVAS_WIDTH: i32 = BUBBLE_MAX_WIDTH;
pub const CANVAS_HEIGHT: i32 = BUBBLE_AREA_HEIGHT + PET_AREA;
/// 桌宠 128×128 区在画布上的左上角：水平居中、垂直贴底。
const PET_ORIGIN_X: i32 = (CANVAS_WIDTH - PET_AREA) / 2;
const PET_ORIGIN_Y: i32 = BUBBLE_AREA_HEIGHT;

struct Visual {
    frame: Option<Pixbuf>,
    off_x: i32,
    off_y: i32,
    bubbles: Vec<BubbleItem>,
}

/// 承载桌宠 + 气泡的透明异形窗口。Wayland 协议禁止客户端定位 toplevel，
/// 所以把气泡画进桌宠窗内部（同一个 toplevel），气泡天然跟着桌宠走。
pub struct PetWindow {
    window: gtk::Window,
    visual: Rc<RefCell<Visual>>,
}

impl PetWindow {
    pub fn new() -> Self {
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_title("Sema Pet");
        window.set_decorated(false);
        window.set_resizable(false);
        window.set_skip_taskbar_hint(true);
        window.set_skip_pager_hint(true);
        window.set_keep_above(true);
        // 不要 set_accept_focus(false)：那会让 WM 拒绝把焦点交给本窗口，
        // 进而导致 GtkMenu::popup_at_pointer 无法建立 pointer/keyboard grab，
        // 右键菜单出来后点击外部不会自动关闭。Dock type hint + skip_taskbar/pager
        // 已经能让窗口不进 alt-tab / 任务栏，不需要 accept_focus=false 再保险。
        window.set_focus_on_map(false);
        // Dock 类型在 Mutter / KWin / XFWM / Compiz 下都强制 always-on-top；
        // 只要不设 _NET_WM_STRUT，WM 不会给它保留空间。比 Notification 更稳，
        // Notification 在部分 WM 下被当作短暂通知层，焦点切换后可能掉层。
        window.set_type_hint(gdk::WindowTypeHint::Dock);
        window.set_app_paintable(true);
        window.set_size_request(CANVAS_WIDTH, CANVAS_HEIGHT);
        window.set_default_size(CANVAS_WIDTH, CANVAS_HEIGHT);
        window.add_events(
            gdk::EventMask::BUTTON_PRESS_MASK
                | gdk::EventMask::BUTTON_RELEASE_MASK
                | gdk::EventMask::POINTER_MOTION_MASK,
        );
        apply_rgba_visual(&window);
        window.connect_screen_changed(|w, _| apply_rgba_visual(w));

        let visual = Rc::new(RefCell::new(Visual {
            frame: None,
            off_x: PET_ORIGIN_X,
            off_y: PET_ORIGIN_Y,
            bubbles: Vec::new(),
        }));

        {
            let visual = Rc::clone(&visual);
            window.connect_draw(move |_w, cr| {
                cr.set_operator(cairo::Operator::Source);
                cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
                let _ = cr.paint();
                cr.set_operator(cairo::Operator::Over);

                let visual = visual.borrow();
                draw_bubbles(cr, &visual.bubbles);
                if let Some(frame) = visual.frame.as_ref() {
                    cr.set_source_pixbuf(frame, visual.off_x as f64, visual.off_y as f64);
                    let _ = cr.paint();
                }
                glib::Propagation::Proceed
            });
        }

        {
            // 窗口 realize 后才有 GdkWindow，补一次 input shape。
            let visual = Rc::clone(&visual);
            window.connect_realize(move |w| {
                let visual = visual.borrow();
                if let Some(frame) = visual.frame.as_ref() {
                    apply_input_shape(w, frame, visual.off_x, visual.off_y);
                }
            });
        }

        // WM 一旦取消 _NET_WM_STATE_ABOVE（焦点切换后 Mutter 常做这件事），
        // 立即恢复。事件驱动比 timer 轮询更及时，且不会产生空转开销。
        window.connect_window_state_event(|w, event| {
            if !event.new_window_state().contains(gdk::WindowState::ABOVE) {
                w.set_keep_above(true);
            }
            glib::Propagation::Proceed
        });

        Self { window, visual }
    }

    pub fn widget(&self) -> &gtk::Window {
        &self.window
    }

    /// 切换显示帧：在画布桌宠区居中绘制 + 按 alpha 重算 input shape。
    pub fn show_frame(&self, frame: &Pixbuf) {
        let off_x = PET_ORIGIN_X + (PET_AREA - frame.width()) / 2;
        let off_y = PET_ORIGIN_Y + (PET_AREA - frame.height()) / 2;
        {
            let mut visual = self.visual.borrow_mut();
            visual.frame = Some(frame.clone());
            visual.off_x = off_x;
            visual.off_y = off_y;
        }
        self.window.queue_draw();
        apply_input_shape(&self.window, frame, off_x, off_y);
    }

    /// 更新气泡列表；空集即清空。气泡画在画布顶部，紧贴桌宠头顶上方。
    pub fn show_bubbles(&self, items: &[BubbleItem]) {
        let visible: Vec<BubbleItem> = items.iter().take(SAY_MAX_VISIBLE).cloned().collect();
        {
            let mut visual = self.visual.borrow_mut();
            if visual.bubbles == visible {
                return;
            }
            visual.bubbles = visible;
        }
        self.window.queue_draw();
    }
}

fn apply_rgba_visual(window: &gtk::Window) {
    if let Some(screen) = gdk::Screen::default() {
        if let Some(rgba) = screen.rgba_visual() {
            window.set_visual(Some(&rgba));
        }
    }
}

fn apply_input_shape(window: &gtk::Window, frame: &Pixbuf, off_x: i32, off_y: i32) {
    let Some(gdk_window) = window.window() else {
        return;
    };
    // alpha mask 只覆盖桌宠区；气泡区永远落在 input shape 之外 → 点击穿透下层窗口。
    let alpha = build_canvas_alpha(frame, off_x, off_y);
    let region = cairo::Region::create();
    for run in alpha_mask_to_runs(
        &alpha,
        CANVAS_WIDTH as usize,
        CANVAS_HEIGHT as usize,
        HIT_THRESHOLD,
    ) {
        let _ = region.union_rectangle(&cairo::RectangleInt::new(run.x, run.y, run.width, 1));
    }
    gdk_window.input_shape_combine_region(&region, 0, 0);
}

/// 把帧的 alpha 通道按画布偏移铺进 CANVAS_WIDTH×CANVAS_HEIGHT 的紧凑数组。
fn build_canvas_alpha(frame: &Pixbuf, off_x: i32, off_y: i32) -> Vec<u8> {
    let mut alpha = vec![0_u8; (CANVAS_WIDTH * CANVAS_HEIGHT) as usize];
    let frame_width = frame.width();
    let frame_height = frame.height();
    let channels = frame.n_channels();
    let rowstride = frame.rowstride();
    let has_alpha = frame.has_alpha();
    let bytes = frame.read_pixel_bytes();
    let data: &[u8] = &bytes;

    for y in 0..frame_height {
        for x in 0..frame_width {
            let value = if has_alpha && channels == 4 {
                let index = (y * rowstride + x * channels + 3) as usize;
                data.get(index).copied().unwrap_or(255)
            } else {
                255
            };
            let canvas_x = x + off_x;
            let canvas_y = y + off_y;
            if canvas_x >= 0
                && canvas_x < CANVAS_WIDTH
                && canvas_y >= 0
                && canvas_y < CANVAS_HEIGHT
            {
                alpha[(canvas_y * CANVAS_WIDTH + canvas_x) as usize] = value;
            }
        }
    }
    alpha
}

fn draw_bubbles(cr: &cairo::Context, items: &[BubbleItem]) {
    if items.is_empty() {
        return;
    }
    let width = bubble_width(items);
    let count = items.len() as i32;
    let total_height = count * BUBBLE_HEIGHT + (count - 1) * BUBBLE_GAP;
    // 气泡块紧贴桌宠头顶上方（间距 BUBBLE_ANCHOR_GAP）。
    let block_bottom = PET_ORIGIN_Y - BUBBLE_ANCHOR_GAP;
    let block_top = block_bottom - total_height;
    let x = (CANVAS_WIDTH - width) / 2;

    for (index, item) in items.iter().enumerate() {
        let top = block_top + index as i32 * (BUBBLE_HEIGHT + BUBBLE_GAP);
        let (r, g, b, a) = match item.kind {
            BubbleKind::Attention => (0.96, 0.53, 0.0, 0.92),
            BubbleKind::Info => (0.0, 0.0, 0.0, 0.85),
        };
        rounded_rect(
            cr,
            x as f64,
            top as f64,
            width as f64,
            BUBBLE_HEIGHT as f64,
            BUBBLE_RADIUS,
        );
        cr.set_source_rgba(r, g, b, a);
        let _ = cr.fill();
        draw_text(cr, &item.text, x, top, width);
    }
}

fn draw_text(cr: &cairo::Context, text: &str, x: i32, top: i32, width: i32) {
    let layout = pangocairo::functions::create_layout(cr);
    layout.set_font_description(Some(&pango::FontDescription::from_string("Sans 10")));
    layout.set_text(text);
    layout.set_single_paragraph_mode(true);
    layout.set_ellipsize(pango::EllipsizeMode::End);
    let text_width = (width - TEXT_PADDING_X * 2).max(1);
    layout.set_width(text_width * pango::SCALE);

    let (_, text_height) = layout.pixel_size();
    let y = top + (BUBBLE_HEIGHT - text_height) / 2;
    cr.move_to((x + TEXT_PADDING_X) as f64, y as f64);
    cr.set_source_rgba(1.0, 1.0, 1.0, 1.0);
    pangocairo::functions::show_layout(cr, &layout);
}

fn rounded_rect(cr: &cairo::Context, x: f64, y: f64, width: f64, height: f64, radius: f64) {
    let radius = radius.min(width / 2.0).min(height / 2.0);
    let degrees = std::f64::consts::PI / 180.0;
    cr.new_sub_path();
    cr.arc(x + width - radius, y + radius, radius, -90.0 * degrees, 0.0);
    cr.arc(
        x + width - radius,
        y + height - radius,
        radius,
        0.0,
        90.0 * degrees,
    );
    cr.arc(
        x + radius,
        y + height - radius,
        radius,
        90.0 * degrees,
        180.0 * degrees,
    );
    cr.arc(x + radius, y + radius, radius, 180.0 * degrees, 270.0 * degrees);
    cr.close_path();
}

fn bubble_width(items: &[BubbleItem]) -> i32 {
    let widest = items
        .iter()
        .map(|item| estimate_text_width(&item.text))
        .max()
        .unwrap_or(1)
        .min(TEXT_MAX_WIDTH);
    (widest + TEXT_PADDING_X * 2).clamp(1, BUBBLE_MAX_WIDTH)
}

fn estimate_text_width(text: &str) -> i32 {
    text.chars()
        .map(|ch| if ch.is_ascii() { 7 } else { 12 })
        .sum::<i32>()
        .max(1)
}
