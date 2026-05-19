use std::mem::zeroed;
use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Graphics::GdiPlus::{
    BitmapData, FrameDimensionTime, GdipBitmapLockBits, GdipBitmapUnlockBits,
    GdipCreateBitmapFromFile, GdipDisposeImage, GdipGetImageHeight, GdipGetImageWidth,
    GdipImageGetFrameCount, GdipImageSelectActiveFrame, GdiplusShutdown, GdiplusStartup,
    GdiplusStartupInput, ImageLockModeRead, Rect,
};

use crate::win32::wide_path;

const OK: i32 = 0;
const PIXEL_FORMAT_32BPP_PARGB: i32 = 0x000e200b;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedFrame {
    pub width: i32,
    pub height: i32,
    pub bgra: Vec<u8>,
    pub alpha: Vec<u8>,
}

pub fn decode_first_frame_from_file(path: &Path) -> Option<DecodedFrame> {
    decode_frames_from_file(path).and_then(|mut frames| {
        if frames.is_empty() {
            None
        } else {
            Some(frames.remove(0))
        }
    })
}

pub fn decode_frames_from_file(path: &Path) -> Option<Vec<DecodedFrame>> {
    unsafe {
        let gdiplus = GdiPlusSession::start()?;
        let _gdiplus = gdiplus;

        let mut bitmap = null_mut();
        let path_wide = wide_path(path);
        if GdipCreateBitmapFromFile(path_wide.as_ptr(), &mut bitmap) != OK || bitmap.is_null() {
            return None;
        }

        let image = bitmap as *mut _;
        let mut frame_count = 1;
        if GdipImageGetFrameCount(image, &FrameDimensionTime, &mut frame_count) == OK
            && frame_count == 0
        {
            frame_count = 1;
        }

        let mut width = 0;
        let mut height = 0;
        if GdipGetImageWidth(image, &mut width) != OK
            || GdipGetImageHeight(image, &mut height) != OK
        {
            GdipDisposeImage(image);
            return None;
        }
        if width == 0 || height == 0 {
            GdipDisposeImage(image);
            return None;
        }

        let mut frames = Vec::new();
        for frame_index in 0..frame_count {
            let _ = GdipImageSelectActiveFrame(image, &FrameDimensionTime, frame_index);
            if let Some(frame) = decode_current_frame(bitmap, width, height) {
                frames.push(frame);
            }
        }
        GdipDisposeImage(image);
        if frames.is_empty() {
            None
        } else {
            Some(frames)
        }
    }
}

unsafe fn decode_current_frame(
    bitmap: *mut windows_sys::Win32::Graphics::GdiPlus::GpBitmap,
    width: u32,
    height: u32,
) -> Option<DecodedFrame> {
    let rect = Rect {
        X: 0,
        Y: 0,
        Width: width as i32,
        Height: height as i32,
    };
    let mut locked: BitmapData = zeroed();
    if GdipBitmapLockBits(
        bitmap,
        &rect,
        ImageLockModeRead as u32,
        PIXEL_FORMAT_32BPP_PARGB,
        &mut locked,
    ) != OK
    {
        return None;
    }

    let row_bytes = width as usize * 4;
    let mut bgra = vec![0_u8; row_bytes * height as usize];
    let stride = locked.Stride.unsigned_abs() as usize;
    let top_down = locked.Stride >= 0;
    for y in 0..height as usize {
        let source_y = if top_down { y } else { height as usize - 1 - y };
        let source = (locked.Scan0 as *const u8).add(source_y * stride);
        let target_offset = y * row_bytes;
        std::ptr::copy_nonoverlapping(source, bgra[target_offset..].as_mut_ptr(), row_bytes);
    }
    let _ = GdipBitmapUnlockBits(bitmap, &mut locked);

    let alpha = bgra.chunks_exact(4).map(|pixel| pixel[3]).collect();
    Some(DecodedFrame {
        width: width as i32,
        height: height as i32,
        bgra,
        alpha,
    })
}

pub fn scale_frame_to_canvas(
    frame: &DecodedFrame,
    canvas_width: i32,
    canvas_height: i32,
) -> DecodedFrame {
    if frame.width <= 0 || frame.height <= 0 || canvas_width <= 0 || canvas_height <= 0 {
        return DecodedFrame {
            width: canvas_width.max(0),
            height: canvas_height.max(0),
            bgra: Vec::new(),
            alpha: Vec::new(),
        };
    }

    let scale =
        (canvas_width as f32 / frame.width as f32).min(canvas_height as f32 / frame.height as f32);
    let scaled_width = ((frame.width as f32 * scale).round() as i32).max(1);
    let scaled_height = ((frame.height as f32 * scale).round() as i32).max(1);
    let offset_x = (canvas_width - scaled_width) / 2;
    let offset_y = (canvas_height - scaled_height) / 2;

    let mut bgra = vec![0_u8; (canvas_width * canvas_height * 4) as usize];
    for y in 0..scaled_height {
        let source_y = ((y as f32 / scaled_height as f32) * frame.height as f32)
            .floor()
            .min((frame.height - 1) as f32) as i32;
        for x in 0..scaled_width {
            let source_x = ((x as f32 / scaled_width as f32) * frame.width as f32)
                .floor()
                .min((frame.width - 1) as f32) as i32;
            let source_offset = ((source_y * frame.width + source_x) * 4) as usize;
            let target_x = offset_x + x;
            let target_y = offset_y + y;
            let target_offset = ((target_y * canvas_width + target_x) * 4) as usize;
            bgra[target_offset..target_offset + 4]
                .copy_from_slice(&frame.bgra[source_offset..source_offset + 4]);
        }
    }
    let alpha = bgra.chunks_exact(4).map(|pixel| pixel[3]).collect();

    DecodedFrame {
        width: canvas_width,
        height: canvas_height,
        bgra,
        alpha,
    }
}

struct GdiPlusSession {
    token: usize,
}

impl GdiPlusSession {
    unsafe fn start() -> Option<Self> {
        let input = GdiplusStartupInput {
            GdiplusVersion: 1,
            DebugEventCallback: 0,
            SuppressBackgroundThread: 0,
            SuppressExternalCodecs: 0,
        };
        let mut token = 0;
        if GdiplusStartup(&mut token, &input, null_mut()) != OK {
            return None;
        }
        Some(Self { token })
    }
}

impl Drop for GdiPlusSession {
    fn drop(&mut self) {
        unsafe {
            GdiplusShutdown(self.token);
        }
    }
}
