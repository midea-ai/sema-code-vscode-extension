use crate::protocol::PetState;

pub struct TestSprite {
    pub width: i32,
    pub height: i32,
    pub bgra: Vec<u8>,
    pub alpha: Vec<u8>,
}

impl TestSprite {
    pub fn paw() -> Self {
        Self::for_state(PetState::Idle)
    }

    pub fn for_state(state: PetState) -> Self {
        let width = 128;
        let height = 128;
        let mut bgra = vec![0_u8; (width * height * 4) as usize];
        let mut alpha = vec![0_u8; (width * height) as usize];
        let base = match state {
            PetState::Attention => [0, 132, 255, 235],
            PetState::Working => [76, 148, 255, 230],
            PetState::Thinking => [190, 110, 255, 225],
            PetState::Idle => [120, 180, 120, 210],
            PetState::Sleeping => [150, 150, 150, 190],
        };
        let toe = match state {
            PetState::Attention => [0, 170, 255, 225],
            PetState::Working => [90, 174, 255, 220],
            PetState::Thinking => [205, 145, 255, 215],
            PetState::Idle => [145, 205, 145, 205],
            PetState::Sleeping => [170, 170, 170, 180],
        };

        draw_ellipse(&mut bgra, &mut alpha, width, height, 64, 76, 34, 30, base);
        draw_ellipse(&mut bgra, &mut alpha, width, height, 38, 44, 14, 18, toe);
        draw_ellipse(&mut bgra, &mut alpha, width, height, 58, 34, 14, 18, toe);
        draw_ellipse(&mut bgra, &mut alpha, width, height, 80, 34, 14, 18, toe);
        draw_ellipse(&mut bgra, &mut alpha, width, height, 102, 46, 14, 18, toe);

        Self {
            width,
            height,
            bgra,
            alpha,
        }
    }
}

fn draw_ellipse(
    bgra: &mut [u8],
    alpha: &mut [u8],
    width: i32,
    height: i32,
    cx: i32,
    cy: i32,
    rx: i32,
    ry: i32,
    color_bgra: [u8; 4],
) {
    let min_y = (cy - ry).max(0);
    let max_y = (cy + ry).min(height - 1);
    let min_x = (cx - rx).max(0);
    let max_x = (cx + rx).min(width - 1);

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let nx = (x - cx) as f32 / rx as f32;
            let ny = (y - cy) as f32 / ry as f32;
            if nx * nx + ny * ny <= 1.0 {
                let pixel = (y * width + x) as usize;
                let bgra_index = pixel * 4;
                bgra[bgra_index..bgra_index + 4].copy_from_slice(&color_bgra);
                alpha[pixel] = color_bgra[3];
            }
        }
    }
}
