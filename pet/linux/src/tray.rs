use crate::messages::UiMessage;
use crate::protocol::PetState;
use crate::state_machine::SessionSnapshot;

/// 菜单项被点击后要执行的动作。GTK 右键菜单和 ksni 托盘菜单共用。
#[derive(Debug, Clone)]
pub enum MenuAction {
    FocusSession(String),
    Quit,
}

impl MenuAction {
    pub fn to_message(&self) -> UiMessage {
        match self {
            MenuAction::FocusSession(session_id) => {
                UiMessage::FocusSession(session_id.clone())
            }
            MenuAction::Quit => UiMessage::Quit,
        }
    }
}

/// 与平台无关的菜单条目描述。
#[derive(Debug, Clone)]
pub enum MenuEntry {
    Item { label: String, action: MenuAction },
    Disabled(String),
    Separator,
}

/// 按当前会话列表构造菜单条目，GTK 右键菜单与托盘菜单共用同一份。
pub fn build_menu_entries(sessions: &[SessionSnapshot]) -> Vec<MenuEntry> {
    let mut entries = Vec::new();

    if sessions.is_empty() {
        entries.push(MenuEntry::Disabled("No active sessions".to_string()));
    } else {
        for session in sessions {
            entries.push(MenuEntry::Item {
                label: format!("{} - {}", session.project_name, state_label(session.state)),
                action: MenuAction::FocusSession(session.session_id.clone()),
            });
        }
    }

    entries.push(MenuEntry::Separator);
    entries.push(MenuEntry::Item {
        label: "Exit Sema Pet".to_string(),
        action: MenuAction::Quit,
    });
    entries
}

pub fn state_label(state: PetState) -> &'static str {
    match state {
        PetState::Idle => "idle",
        PetState::Thinking => "thinking",
        PetState::Working => "working",
        PetState::Attention => "attention",
        PetState::Sleeping => "sleeping",
    }
}

/// StatusNotifierItem 托盘实现。运行在 ksni 自己的 D-Bus 线程上，
/// 菜单回调通过 glib channel 把动作投递回 GTK 主线程。
pub struct PetTray {
    pub sessions: Vec<SessionSnapshot>,
    pub tx: glib::Sender<UiMessage>,
}

impl ksni::Tray for PetTray {
    fn id(&self) -> String {
        "sema-pet".to_string()
    }

    fn title(&self) -> String {
        "Sema Pet".to_string()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        vec![paw_icon(32)]
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::{MenuItem, StandardItem};

        let mut items: Vec<MenuItem<Self>> = Vec::new();
        for entry in build_menu_entries(&self.sessions) {
            match entry {
                MenuEntry::Item { label, action } => {
                    items.push(
                        StandardItem {
                            label,
                            activate: Box::new(move |tray: &mut PetTray| {
                                let _ = tray.tx.send(action.to_message());
                            }),
                            ..Default::default()
                        }
                        .into(),
                    );
                }
                MenuEntry::Disabled(label) => {
                    items.push(
                        StandardItem {
                            label,
                            enabled: false,
                            ..Default::default()
                        }
                        .into(),
                    );
                }
                MenuEntry::Separator => items.push(MenuItem::Separator),
            }
        }
        items
    }
}

/// 生成爪印图标，ARGB32 像素数据（ksni 要求的格式）。
fn paw_icon(size: i32) -> ksni::Icon {
    let mut data = vec![0_u8; (size * size * 4) as usize];
    let color = [0xff_u8, 0x8e, 0x8e, 0x8e]; // ARGB，灰色爪印
    let scale = size as f32 / 23.0;
    let paw_size = 11.0 * scale;
    let gap = 1.0 * scale;
    let total_width = 23.0 * scale;
    let total_height = 16.0 * scale;
    let left_x = (size as f32 - total_width) * 0.5;
    let top_y = (size as f32 - total_height) * 0.5;
    let left_y = top_y + 3.0 * scale;
    let right_x = left_x + paw_size + gap;
    let right_y = top_y;

    paint_paw(&mut data, size, left_x, left_y, paw_size, color);
    paint_paw(&mut data, size, right_x, right_y, paw_size, color);

    ksni::Icon {
        width: size,
        height: size,
        data,
    }
}

fn paint_paw(data: &mut [u8], size: i32, x: f32, y: f32, paw_size: f32, color: [u8; 4]) {
    let pads = [
        (0.50, 0.62, 0.22),
        (0.30, 0.35, 0.11),
        (0.43, 0.25, 0.10),
        (0.58, 0.25, 0.10),
        (0.71, 0.35, 0.11),
    ];
    for (fx, fy, fr) in pads {
        fill_circle(
            data,
            size,
            x + paw_size * fx,
            y + paw_size * fy,
            paw_size * fr,
            color,
        );
    }
}

fn fill_circle(data: &mut [u8], size: i32, cx: f32, cy: f32, radius: f32, color: [u8; 4]) {
    let radius_sq = radius * radius;
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy > radius_sq {
                continue;
            }
            let offset = ((y * size + x) * 4) as usize;
            data[offset..offset + 4].copy_from_slice(&color);
        }
    }
}
