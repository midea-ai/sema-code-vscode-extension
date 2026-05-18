use sema_pet_windows::tray::paint_paw_icon_bgra;

#[test]
fn paw_icon_painter_draws_transparent_and_opaque_pixels() {
    let mut pixels = vec![0_u8; 32 * 32 * 4];

    paint_paw_icon_bgra(&mut pixels, 32);

    let opaque_pixels = pixels.chunks_exact(4).filter(|pixel| pixel[3] > 0).count();
    let transparent_pixels = pixels.chunks_exact(4).filter(|pixel| pixel[3] == 0).count();

    assert!(opaque_pixels > 80);
    assert!(transparent_pixels > 80);
}
