#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaskRun {
    pub x: i32,
    pub y: i32,
    pub width: i32,
}

pub fn alpha_mask_to_runs(
    alpha: &[u8],
    width: usize,
    height: usize,
    threshold: u8,
) -> Vec<MaskRun> {
    assert_eq!(
        alpha.len(),
        width * height,
        "alpha mask length must match dimensions"
    );

    let mut runs = Vec::new();
    for y in 0..height {
        let mut x = 0;
        while x < width {
            while x < width && alpha[y * width + x] <= threshold {
                x += 1;
            }

            let start = x;
            while x < width && alpha[y * width + x] > threshold {
                x += 1;
            }

            if x > start {
                runs.push(MaskRun {
                    x: start as i32,
                    y: y as i32,
                    width: (x - start) as i32,
                });
            }
        }
    }

    runs
}
