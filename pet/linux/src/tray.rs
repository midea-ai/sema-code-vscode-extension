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

/// 与平台无关的菜单条目描述。GTK 菜单与 SNI 托盘菜单走不同渲染路径
/// （前者本地 GTK 主题，后者由 host 渲染），无法做到图标位置/间距一致。
/// 选择两边都不画状态色圆点，仅靠 label 文本 "项目 — working" 传达状态，
/// 保持视觉统一。
#[derive(Debug, Clone)]
pub enum MenuEntry {
    Item { label: String, action: MenuAction },
    Disabled(String),
    Separator,
}

/// 按当前会话列表构造菜单条目，GTK 右键菜单与托盘菜单共用同一份。
/// 会话按 (priority desc, last_event_at desc) 排序，与 mac 端一致。
pub fn build_menu_entries(sessions: &[SessionSnapshot]) -> Vec<MenuEntry> {
    let mut entries = Vec::new();

    if sessions.is_empty() {
        entries.push(MenuEntry::Disabled("暂无活跃会话".to_string()));
    } else {
        let mut sorted: Vec<&SessionSnapshot> = sessions.iter().collect();
        sorted.sort_by(|a, b| {
            b.state
                .priority()
                .cmp(&a.state.priority())
                .then(b.last_event_at.cmp(&a.last_event_at))
        });
        for session in sorted {
            entries.push(MenuEntry::Item {
                label: format!("{} — {}", session.project_name, state_label(session.state)),
                action: MenuAction::FocusSession(session.session_id.clone()),
            });
        }
    }

    entries.push(MenuEntry::Separator);
    entries.push(MenuEntry::Item {
        label: "退出桌宠".to_string(),
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
        // 提供多档分辨率，让不同 DE / 缩放率自行挑选，避免单档被强缩糊掉。
        [22, 32, 48, 64].iter().map(|&size| paw_icon(size)).collect()
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
/// 白色 + 撑满图标尺寸，对齐 mac 端的视觉。
fn paw_icon(size: i32) -> ksni::Icon {
    let mut data = vec![0_u8; (size * size * 4) as usize];
    let color = [0xff_u8, 0xff, 0xff, 0xff]; // ARGB，白色爪印
    // 双爪逻辑尺寸 16×11（宽×高，含 1px 间隙），让它填满整个图标。
    let logical_w = 16.0;
    let logical_h = 11.0;
    let scale = (size as f32 / logical_w).min(size as f32 / logical_h);
    let paw_size = 7.5 * scale;
    let gap = 1.0 * scale;
    let total_width = paw_size * 2.0 + gap;
    let total_height = 11.0 * scale;
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
        (0.50, 0.62, 0.30),
        (0.22, 0.30, 0.16),
        (0.40, 0.18, 0.15),
        (0.60, 0.18, 0.15),
        (0.78, 0.30, 0.16),
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

