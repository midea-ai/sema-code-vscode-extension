use sema_pet_windows::hit_region::{alpha_mask_to_runs, MaskRun};

#[test]
fn alpha_mask_to_runs_merges_contiguous_opaque_pixels_by_row() {
    let alpha = [0, 17, 18, 0, 40, 0, 0, 255, 255, 0];

    let runs = alpha_mask_to_runs(&alpha, 5, 2, 16);

    assert_eq!(
        runs,
        vec![
            MaskRun {
                x: 1,
                y: 0,
                width: 2
            },
            MaskRun {
                x: 4,
                y: 0,
                width: 1
            },
            MaskRun {
                x: 2,
                y: 1,
                width: 2
            },
        ]
    );
}
