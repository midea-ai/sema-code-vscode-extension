use std::fs;

use sema_pet_windows::assets::default_asset_bytes;
use sema_pet_windows::gif_decoder::{
    decode_first_frame_from_file, decode_frames_from_file, scale_frame_to_canvas,
};
use sema_pet_windows::protocol::PetState;

#[test]
fn decode_first_frame_from_file_reads_default_gif_as_bgra() {
    let path = std::env::temp_dir().join(format!(
        "sema-pet-windows-decode-{}.gif",
        std::process::id()
    ));
    fs::write(&path, default_asset_bytes(PetState::Idle)).unwrap();

    let frame = decode_first_frame_from_file(&path).unwrap();

    assert!(frame.width > 0);
    assert!(frame.height > 0);
    assert_eq!(frame.bgra.len(), (frame.width * frame.height * 4) as usize);
    assert_eq!(frame.alpha.len(), (frame.width * frame.height) as usize);
    assert!(
        frame.alpha.iter().any(|alpha| *alpha > 16),
        "decoded frame must keep enough alpha for hit testing"
    );
}

#[test]
fn decode_frames_from_file_reads_animated_default_gif_frames() {
    let path = std::env::temp_dir().join(format!(
        "sema-pet-windows-frames-{}.gif",
        std::process::id()
    ));
    fs::write(&path, default_asset_bytes(PetState::Attention)).unwrap();

    let frames = decode_frames_from_file(&path).unwrap();

    assert!(frames.len() > 1);
    assert!(frames
        .iter()
        .all(|frame| frame.width > 0 && frame.height > 0));
}

#[test]
fn scale_frame_to_canvas_fits_large_gif_into_pet_window() {
    let path =
        std::env::temp_dir().join(format!("sema-pet-windows-scale-{}.gif", std::process::id()));
    fs::write(&path, default_asset_bytes(PetState::Working)).unwrap();
    let frame = decode_first_frame_from_file(&path).unwrap();

    let scaled = scale_frame_to_canvas(&frame, 128, 128);

    assert_eq!(scaled.width, 128);
    assert_eq!(scaled.height, 128);
    assert_eq!(scaled.bgra.len(), 128 * 128 * 4);
    assert!(scaled.alpha.iter().any(|alpha| *alpha > 16));
}
