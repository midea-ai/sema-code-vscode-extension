use std::cell::RefCell;
use std::rc::Rc;

use gdk::prelude::*;
use gdk_pixbuf::Pixbuf;
use gtk::prelude::*;

use crate::gif_animation::CANVAS;
use crate::hit_region::alpha_mask_to_runs;

/// alpha 命中阈值：> 16 视为不透明、可点击；其余区域点击穿透到背后窗口。
const HIT_THRESHOLD: u8 = 16;

struct Visual {
    frame: Option<Pixbuf>,
    off_x: i32,
    off_y: i32,
}

/// 承载桌宠的透明异形窗口。固定 128×128 画布，GIF 帧居中绘制，
/// 透明像素通过 input shape 实现点击穿透 —— Linux 因此只需一个窗口。
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
        window.set_accept_focus(false);
        window.set_focus_on_map(false);
        window.set_type_hint(gdk::WindowTypeHint::Utility);
        window.set_app_paintable(true);
        window.set_size_request(CANVAS, CANVAS);
        window.set_default_size(CANVAS, CANVAS);
        window.add_events(
            gdk::EventMask::BUTTON_PRESS_MASK
                | gdk::EventMask::BUTTON_RELEASE_MASK
                | gdk::EventMask::POINTER_MOTION_MASK,
        );
        apply_rgba_visual(&window);
        window.connect_screen_changed(|w, _| apply_rgba_visual(w));

        let visual = Rc::new(RefCell::new(Visual {
            frame: None,
            off_x: 0,
            off_y: 0,
        }));

        {
            let visual = Rc::clone(&visual);
            window.connect_draw(move |_w, cr| {
                // 先把整窗清成全透明，再贴当前帧。
                cr.set_operator(cairo::Operator::Source);
                cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
                let _ = cr.paint();
                cr.set_operator(cairo::Operator::Over);
                let visual = visual.borrow();
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

        Self { window, visual }
    }

    pub fn widget(&self) -> &gtk::Window {
        &self.window
    }

    /// 切换显示帧：居中绘制 + 按 alpha 重算 input shape。
    pub fn show_frame(&self, frame: &Pixbuf) {
        let off_x = (CANVAS - frame.width()) / 2;
        let off_y = (CANVAS - frame.height()) / 2;
        {
            let mut visual = self.visual.borrow_mut();
            visual.frame = Some(frame.clone());
            visual.off_x = off_x;
            visual.off_y = off_y;
        }
        self.window.queue_draw();
        apply_input_shape(&self.window, frame, off_x, off_y);
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
    let alpha = build_canvas_alpha(frame, CANVAS, off_x, off_y);
    let region = cairo::Region::create();
    for run in alpha_mask_to_runs(&alpha, CANVAS as usize, CANVAS as usize, HIT_THRESHOLD) {
        let _ = region.union_rectangle(&cairo::RectangleInt::new(run.x, run.y, run.width, 1));
    }
    gdk_window.input_shape_combine_region(&region, 0, 0);
}

/// 把帧的 alpha 通道按居中偏移铺进 CANVAS×CANVAS 的紧凑数组。
fn build_canvas_alpha(frame: &Pixbuf, canvas: i32, off_x: i32, off_y: i32) -> Vec<u8> {
    let mut alpha = vec![0_u8; (canvas * canvas) as usize];
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
            if canvas_x >= 0 && canvas_x < canvas && canvas_y >= 0 && canvas_y < canvas {
                alpha[(canvas_y * canvas + canvas_x) as usize] = value;
            }
        }
    }
    alpha
}
