use std::cell::RefCell;
use std::rc::Rc;

use gtk::prelude::*;

use crate::bubble_store::{BubbleItem, BubbleKind};
use crate::protocol::SAY_MAX_VISIBLE;

const BUBBLE_HEIGHT: i32 = 26;
const BUBBLE_GAP: i32 = 4;
const BUBBLE_RADIUS: f64 = 8.0;
const TEXT_PADDING_X: i32 = 10;
const TEXT_MAX_WIDTH: i32 = 220;
const BUBBLE_MAX_WIDTH: i32 = 240;
const BUBBLE_ANCHOR_GAP: i32 = 4;
const PET_LOGICAL_SIZE: i32 = 128;

/// 顶部气泡窗：一个透明、点击穿透的 toplevel，把最多 3 条气泡竖排画在一起，
/// 跟随桌宠定位在其正上方。
pub struct BubbleWindow {
    window: gtk::Window,
    bubbles: Rc<RefCell<Vec<BubbleItem>>>,
}

impl BubbleWindow {
    pub fn new() -> Self {
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_title("Sema Pet Bubble");
        window.set_decorated(false);
        window.set_resizable(false);
        window.set_skip_taskbar_hint(true);
        window.set_skip_pager_hint(true);
        window.set_keep_above(true);
        window.set_accept_focus(false);
        window.set_focus_on_map(false);
        window.set_type_hint(gdk::WindowTypeHint::Notification);
        window.set_app_paintable(true);
        apply_rgba_visual(&window);
        window.connect_screen_changed(|w, _| apply_rgba_visual(w));

        let bubbles: Rc<RefCell<Vec<BubbleItem>>> = Rc::new(RefCell::new(Vec::new()));

        {
            let bubbles = Rc::clone(&bubbles);
            window.connect_draw(move |w, cr| {
                draw_bubbles(w, cr, &bubbles.borrow());
                glib::Propagation::Proceed
            });
        }

        // 空 input region：整窗点击穿透，气泡纯展示、不吃事件。
        window.connect_realize(|w| {
            if let Some(gdk_window) = w.window() {
                gdk_window.input_shape_combine_region(&cairo::Region::create(), 0, 0);
            }
        });

        Self { window, bubbles }
    }

    /// 用最新气泡集刷新窗口；空集则隐藏。`pet_x/pet_y` 是桌宠窗左上角。
    pub fn update(&self, items: &[BubbleItem], pet_x: i32, pet_y: i32) {
        let visible: Vec<BubbleItem> = items.iter().take(SAY_MAX_VISIBLE).cloned().collect();
        if visible.is_empty() {
            *self.bubbles.borrow_mut() = Vec::new();
            self.window.hide();
            return;
        }

        let width = bubble_width(&visible);
        let count = visible.len() as i32;
        let height = count * BUBBLE_HEIGHT + (count - 1) * BUBBLE_GAP;
        *self.bubbles.borrow_mut() = visible;

        self.window.set_size_request(width, height);
        self.window.resize(width, height);
        let x = pet_x + (PET_LOGICAL_SIZE - width) / 2;
        let y = pet_y - height - BUBBLE_ANCHOR_GAP;
        self.window.move_(x, y);
        self.window.show();
        self.window.queue_draw();
    }

    pub fn hide(&self) {
        self.window.hide();
    }
}

fn apply_rgba_visual(window: &gtk::Window) {
    if let Some(screen) = gdk::Screen::default() {
        if let Some(rgba) = screen.rgba_visual() {
            window.set_visual(Some(&rgba));
        }
    }
}

fn draw_bubbles(widget: &gtk::Window, cr: &cairo::Context, items: &[BubbleItem]) {
    cr.set_operator(cairo::Operator::Source);
    cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
    let _ = cr.paint();
    cr.set_operator(cairo::Operator::Over);

    let width = widget.allocated_width();
    for (index, item) in items.iter().enumerate() {
        let top = index as i32 * (BUBBLE_HEIGHT + BUBBLE_GAP);
        let (r, g, b, a) = match item.kind {
            BubbleKind::Attention => (0.96, 0.53, 0.0, 0.92),
            BubbleKind::Info => (0.0, 0.0, 0.0, 0.85),
        };
        rounded_rect(
            cr,
            0.0,
            top as f64,
            width as f64,
            BUBBLE_HEIGHT as f64,
            BUBBLE_RADIUS,
        );
        cr.set_source_rgba(r, g, b, a);
        let _ = cr.fill();
        draw_text(cr, &item.text, width, top);
    }
}

fn draw_text(cr: &cairo::Context, text: &str, width: i32, top: i32) {
    let layout = pangocairo::functions::create_layout(cr);
    layout.set_font_description(Some(&pango::FontDescription::from_string("Sans 10")));
    layout.set_text(text);
    layout.set_single_paragraph_mode(true);
    layout.set_ellipsize(pango::EllipsizeMode::End);
    let text_width = (width - TEXT_PADDING_X * 2).max(1);
    layout.set_width(text_width * pango::SCALE);

    let (_, text_height) = layout.pixel_size();
    let y = top + (BUBBLE_HEIGHT - text_height) / 2;
    cr.move_to(TEXT_PADDING_X as f64, y as f64);
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
