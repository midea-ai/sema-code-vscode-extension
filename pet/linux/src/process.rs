/// 判断进程是否存活。Linux 用 `kill(pid, 0)`：
/// 返回 0 说明进程存在且可发信号；EPERM 说明进程存在但无权发信号（仍算存活）；
/// ESRCH 说明进程不存在。
pub fn is_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    unsafe {
        if libc::kill(pid as libc::pid_t, 0) == 0 {
            return true;
        }
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}
