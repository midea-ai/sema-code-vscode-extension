use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::bubble_store::{BubbleKind, BubbleStore, SayOptions};
use crate::focus_bridge::FocusBridge;
use crate::messages::UiMessage;
use crate::process::is_process_alive;
use crate::protocol::{
    HealthResponse, RegisterPayload, SayPayload, StatePayload, UnregisterPayload, PET_HOST,
    PET_PORT, PET_SERVER_HEADER, PET_SERVER_HEADER_VALUE,
};
use crate::state_machine::{now_ms, StateMachine};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_ACTIVE_CONNECTIONS: usize = 32;

pub struct HttpServerHandle {
    _thread: thread::JoinHandle<()>,
}

pub fn start_http_server(
    state_machine: Arc<Mutex<StateMachine>>,
    bubble_store: Arc<Mutex<BubbleStore>>,
    focus_bridge: Arc<FocusBridge>,
    ui_tx: glib::Sender<UiMessage>,
) -> std::io::Result<HttpServerHandle> {
    let listener = TcpListener::bind((PET_HOST, PET_PORT))?;
    let connection_limit = Arc::new(ConnectionLimit::new(MAX_ACTIVE_CONNECTIONS));
    let thread = thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let Some(connection_guard) = connection_limit.try_acquire() else {
                let _ = write_json(&mut stream, 503, r#"{"error":"server busy"}"#);
                continue;
            };
            let state_machine = Arc::clone(&state_machine);
            let bubble_store = Arc::clone(&bubble_store);
            let focus_bridge = Arc::clone(&focus_bridge);
            let ui_tx = ui_tx.clone();
            thread::spawn(move || {
                let _connection_guard = connection_guard;
                let _ = handle_connection(stream, state_machine, bubble_store, focus_bridge, ui_tx);
            });
        }
    });

    Ok(HttpServerHandle { _thread: thread })
}

fn handle_connection(
    mut stream: TcpStream,
    state_machine: Arc<Mutex<StateMachine>>,
    bubble_store: Arc<Mutex<BubbleStore>>,
    focus_bridge: Arc<FocusBridge>,
    ui_tx: glib::Sender<UiMessage>,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let request = read_http_request(&mut stream)?;
    let parsed = match HttpRequest::parse(&request) {
        Some(parsed) => parsed,
        None => return write_json(&mut stream, 400, r#"{"error":"bad request"}"#),
    };

    match (parsed.method.as_str(), parsed.path.as_str()) {
        ("GET", "/health") => {
            let body = serde_json::to_string(&HealthResponse { ok: true }).unwrap();
            write_json(&mut stream, 200, &body)
        }
        ("POST", "/session/register") => {
            let Some(payload) = parse_json::<RegisterPayload>(&mut stream, &parsed)? else {
                return Ok(());
            };
            let mut state = state_machine.lock().unwrap();
            let removed = state.sweep_stale(is_process_alive);
            let registered =
                state.register(payload.session_id, payload.cwd, payload.client_pid, now_ms());
            drop(state);
            if !removed.is_empty() {
                let mut bubbles = bubble_store.lock().unwrap();
                for session_id in &removed {
                    bubbles.clear_sticky_for_session(session_id);
                }
            }
            let _ = ui_tx.send(UiMessage::StateChanged);
            if !removed.is_empty() {
                let _ = ui_tx.send(UiMessage::BubblesChanged);
            }
            if registered {
                write_json(&mut stream, 200, r#"{"ok":true}"#)
            } else {
                // 同一 cwd 已被别的会话占用：回 409，扩展端 register() 据此判定失败。
                write_json(&mut stream, 409, r#"{"ok":false,"error":"cwd already registered"}"#)
            }
        }
        ("POST", "/session/unregister") => {
            let Some(payload) = parse_json::<UnregisterPayload>(&mut stream, &parsed)? else {
                return Ok(());
            };
            let empty = state_machine.lock().unwrap().unregister(&payload.session_id);
            let _ = ui_tx.send(UiMessage::StateChanged);
            if empty {
                let _ = ui_tx.send(UiMessage::Quit);
            }
            write_json(&mut stream, 200, r#"{"ok":true}"#)
        }
        ("POST", "/state") => {
            let Some(payload) = parse_json::<StatePayload>(&mut stream, &parsed)? else {
                return Ok(());
            };
            state_machine.lock().unwrap().update_state(
                &payload.session_id,
                payload.state,
                payload.ts.unwrap_or_else(now_ms),
            );
            bubble_store
                .lock()
                .unwrap()
                .clear_sticky_for_session(&payload.session_id);
            let _ = ui_tx.send(UiMessage::StateChanged);
            let _ = ui_tx.send(UiMessage::BubblesChanged);
            write_json(&mut stream, 200, r#"{"ok":true}"#)
        }
        ("POST", "/say") => {
            let Some(payload) = parse_json::<SayPayload>(&mut stream, &parsed)? else {
                return Ok(());
            };
            bubble_store.lock().unwrap().add(
                &payload.session_id,
                &payload.text,
                SayOptions {
                    kind: payload.kind.unwrap_or(BubbleKind::Info),
                    ttl_ms: payload.ttl_ms,
                    sticky: payload.sticky.unwrap_or(false),
                },
                now_ms(),
            );
            let _ = ui_tx.send(UiMessage::BubblesChanged);
            write_json(&mut stream, 200, r#"{"ok":true}"#)
        }
        ("GET", "/command") => {
            let session_id = match parsed.query.get("sessionId") {
                Some(session_id) => session_id,
                None => return write_json(&mut stream, 400, r#"{"error":"missing sessionId"}"#),
            };
            let command = focus_bridge.wait_command(session_id, COMMAND_TIMEOUT);
            let body = serde_json::to_string(&command).unwrap();
            write_json(&mut stream, 200, &body)
        }
        _ => write_json(&mut stream, 404, r#"{"error":"not found"}"#),
    }
}

fn parse_json<T: serde::de::DeserializeOwned>(
    stream: &mut TcpStream,
    request: &HttpRequest,
) -> std::io::Result<Option<T>> {
    match serde_json::from_str(&request.body) {
        Ok(payload) => Ok(Some(payload)),
        Err(_) => {
            write_json(stream, 400, r#"{"error":"bad json"}"#)?;
            Ok(None)
        }
    }
}

fn read_http_request<R: Read>(reader: &mut R) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];

    loop {
        let bytes_read = reader.read(&mut chunk)?;
        if bytes_read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..bytes_read]);

        if let Some(header_end) = find_header_end(&bytes) {
            let content_length = content_length(&bytes[..header_end]).unwrap_or(0);
            let body_len = bytes.len().saturating_sub(header_end + 4);
            if body_len >= content_length {
                break;
            }
        }

        if bytes.len() > 1024 * 1024 {
            break;
        }
    }

    Ok(decode_http_request(&bytes))
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn content_length(header: &[u8]) -> Option<usize> {
    let header = String::from_utf8_lossy(header);
    for line in header.lines().skip(1) {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            return value.trim().parse().ok();
        }
    }
    None
}

fn decode_http_request(bytes: &[u8]) -> String {
    // Linux 终端统一 UTF-8，无需 Windows 那套 GBK 兜底。
    let Some(header_end) = find_header_end(bytes) else {
        return String::from_utf8_lossy(bytes).to_string();
    };
    let head = String::from_utf8_lossy(&bytes[..header_end]);
    let body = String::from_utf8_lossy(&bytes[header_end + 4..]);
    format!("{head}\r\n\r\n{body}")
}

fn write_json(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        503 => "Service Unavailable",
        _ => "Internal Server Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\n{PET_SERVER_HEADER}: {PET_SERVER_HEADER_VALUE}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    )
}

struct ConnectionLimit {
    active: Mutex<usize>,
    max: usize,
}

impl ConnectionLimit {
    fn new(max: usize) -> Self {
        Self {
            active: Mutex::new(0),
            max,
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Option<ConnectionGuard> {
        let mut active = self.active.lock().unwrap();
        if *active >= self.max {
            return None;
        }
        *active += 1;
        Some(ConnectionGuard {
            limit: Arc::clone(self),
        })
    }
}

struct ConnectionGuard {
    limit: Arc<ConnectionLimit>,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        let mut active = self.limit.active.lock().unwrap();
        *active = active.saturating_sub(1);
    }
}

struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    body: String,
}

impl HttpRequest {
    fn parse(raw: &str) -> Option<Self> {
        let (head, body) = raw.split_once("\r\n\r\n")?;
        let mut lines = head.lines();
        let request_line = lines.next()?;
        let mut parts = request_line.split_whitespace();
        let method = parts.next()?.to_string();
        let target = parts.next()?;
        let (path, query) = parse_target(target);

        Some(Self {
            method,
            path,
            query,
            body: body.to_string(),
        })
    }
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let Some((path, query_string)) = target.split_once('?') else {
        return (target.to_string(), HashMap::new());
    };

    let mut query = HashMap::new();
    for pair in query_string.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        query.insert(percent_decode(key), percent_decode(value));
    }

    (path.to_string(), query)
}

fn percent_decode(value: &str) -> String {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                output.push(hex);
                i += 3;
                continue;
            }
        }
        output.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Result};

    use super::{read_http_request, HttpRequest};

    struct ChunkedRead {
        chunks: Vec<Vec<u8>>,
        index: usize,
    }

    impl ChunkedRead {
        fn new(chunks: &[&str]) -> Self {
            Self {
                chunks: chunks
                    .iter()
                    .map(|chunk| chunk.as_bytes().to_vec())
                    .collect(),
                index: 0,
            }
        }
    }

    impl Read for ChunkedRead {
        fn read(&mut self, buf: &mut [u8]) -> Result<usize> {
            if self.index >= self.chunks.len() {
                return Ok(0);
            }
            let chunk = &self.chunks[self.index];
            let len = chunk.len().min(buf.len());
            buf[..len].copy_from_slice(&chunk[..len]);
            self.index += 1;
            Ok(len)
        }
    }

    #[test]
    fn read_http_request_reads_body_after_split_headers() {
        let mut reader = ChunkedRead::new(&[
            "POST /session/register HTTP/1.1\r\ncontent-length: 23\r\n\r\n",
            r#"{"sessionId":"test"}"#,
        ]);

        let raw = read_http_request(&mut reader).unwrap();
        let request = HttpRequest::parse(&raw).unwrap();

        assert_eq!(request.body, r#"{"sessionId":"test"}"#);
    }
}
