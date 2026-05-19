/// HTTP / 托盘线程通过 glib channel 把这些消息投递到 GTK 主线程，
/// 取代 Windows 端的 PostMessageW(notify_hwnd, WM_APP_*)。
#[derive(Debug, Clone)]
pub enum UiMessage {
    /// 会话状态有变化，需要重算快照、切换动画。
    StateChanged,
    /// 气泡集合有变化，需要刷新气泡窗口。
    BubblesChanged,
    /// 用户在托盘/右键菜单里点了某个会话，请求聚焦它。
    FocusSession(String),
    /// 最后一个会话注销，或用户点了退出。
    Quit,
}
