use std::time::{Duration, SystemTime};

use gdk_pixbuf::{InterpType, Pixbuf, PixbufAnimation};

/// 桌宠逻辑画布边长。GIF 帧统一缩放到这个方框内（保持比例）。
pub const CANVAS: i32 = 128;

/// GIF 帧间隔下限：有些 GIF 帧延时极短，会把主循环饿死，钳一个底。
const MIN_DELAY: Duration = Duration::from_millis(40);

/// 单个状态的动画：包一份 `PixbufAnimationIter`，对外只暴露「当前帧（已缩放）」
/// 和「推进一帧」。静态图片则 `iter` 为空，`advance` 恒为 false。
pub struct GifAnimation {
    iter: Option<gdk_pixbuf::PixbufAnimationIter>,
    scaled: Pixbuf,
}

impl GifAnimation {
    pub fn from_animation(animation: &PixbufAnimation) -> Self {
        let iter = animation.iter(Some(SystemTime::now()));
        let scaled = scale_to_fit(&iter.pixbuf(), CANVAS);
        Self {
            iter: Some(iter),
            scaled,
        }
    }

    pub fn from_pixbuf(pixbuf: &Pixbuf) -> Self {
        Self {
            iter: None,
            scaled: scale_to_fit(pixbuf, CANVAS),
        }
    }

    /// 当前帧（已缩放到 CANVAS 方框内）。
    pub fn current(&self) -> &Pixbuf {
        &self.scaled
    }

    /// 按当前时间推进动画。返回显示帧是否发生变化。
    pub fn advance(&mut self) -> bool {
        let Some(iter) = self.iter.as_ref() else {
            return false;
        };
        let changed = iter.advance(Some(SystemTime::now()));
        if changed {
            self.scaled = scale_to_fit(&iter.pixbuf(), CANVAS);
        }
        changed
    }

    /// 当前帧到下一帧的延时；静态图片返回 None（不需要动画定时器）。
    pub fn frame_delay(&self) -> Option<Duration> {
        self.iter
            .as_ref()
            .and_then(|iter| iter.delay_time())
            .map(|delay| delay.max(MIN_DELAY))
    }
}

fn scale_to_fit(pixbuf: &Pixbuf, max: i32) -> Pixbuf {
    let width = pixbuf.width();
    let height = pixbuf.height();
    if width <= 0 || height <= 0 {
        return ensure_alpha(pixbuf);
    }
    if width <= max && height <= max {
        return ensure_alpha(pixbuf);
    }
    let scale = (max as f64 / width as f64).min(max as f64 / height as f64);
    let new_width = ((width as f64 * scale).round() as i32).clamp(1, max);
    let new_height = ((height as f64 * scale).round() as i32).clamp(1, max);
    let scaled = pixbuf
        .scale_simple(new_width, new_height, InterpType::Bilinear)
        .unwrap_or_else(|| pixbuf.clone());
    ensure_alpha(&scaled)
}

/// 命中测试需要 alpha 通道；没有 alpha 的帧补一个全不透明的。
fn ensure_alpha(pixbuf: &Pixbuf) -> Pixbuf {
    if pixbuf.has_alpha() {
        pixbuf.clone()
    } else {
        pixbuf
            .add_alpha(false, 0, 0, 0)
            .unwrap_or_else(|| pixbuf.clone())
    }
}
