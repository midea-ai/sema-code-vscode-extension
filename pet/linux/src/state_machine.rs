use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::protocol::PetState;

const SLEEPING_AFTER_MS: u64 = 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub cwd: String,
    pub project_name: String,
    pub state: PetState,
    pub last_event_at: u64,
    pub client_pid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalSnapshot {
    pub state: PetState,
    pub winner_session_id: Option<String>,
    pub sessions: Vec<SessionSnapshot>,
}

#[derive(Default)]
pub struct StateMachine {
    sessions: HashMap<String, SessionSnapshot>,
}

impl StateMachine {
    pub fn register(
        &mut self,
        session_id: String,
        cwd: String,
        client_pid: Option<u32>,
        now_ms: u64,
    ) {
        let project_name = project_name_from_cwd(&cwd);
        self.sessions.insert(
            session_id.clone(),
            SessionSnapshot {
                session_id,
                cwd,
                project_name,
                state: PetState::Idle,
                last_event_at: now_ms,
                client_pid,
            },
        );
    }

    pub fn unregister(&mut self, session_id: &str) -> bool {
        self.sessions.remove(session_id);
        self.sessions.is_empty()
    }

    pub fn update_state(&mut self, session_id: &str, state: PetState, ts: u64) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.state = state;
            session.last_event_at = ts;
        }
    }

    pub fn sweep_stale<F>(&mut self, mut is_alive: F) -> Vec<String>
    where
        F: FnMut(u32) -> bool,
    {
        let mut removed = Vec::new();
        self.sessions.retain(|session_id, session| {
            let keep = session.client_pid.map(&mut is_alive).unwrap_or(true);
            if !keep {
                removed.push(session_id.clone());
            }
            keep
        });
        removed
    }

    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    pub fn snapshot(&self, now_ms: u64) -> GlobalSnapshot {
        let mut sessions: Vec<_> = self.sessions.values().cloned().collect();
        sessions.sort_by(|a, b| {
            a.project_name
                .cmp(&b.project_name)
                .then(a.session_id.cmp(&b.session_id))
        });

        let winner = self.sessions.values().max_by(|a, b| {
            a.state
                .priority()
                .cmp(&b.state.priority())
                .then(a.last_event_at.cmp(&b.last_event_at))
        });

        let all_idle =
            !self.sessions.is_empty() && self.sessions.values().all(|s| s.state == PetState::Idle);
        let state = if all_idle
            && self
                .sessions
                .values()
                .all(|s| now_ms.saturating_sub(s.last_event_at) >= SLEEPING_AFTER_MS)
        {
            PetState::Sleeping
        } else {
            winner.map(|s| s.state).unwrap_or(PetState::Idle)
        };

        GlobalSnapshot {
            state,
            winner_session_id: winner.map(|s| s.session_id.clone()),
            sessions,
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

fn project_name_from_cwd(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(cwd)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::StateMachine;

    #[test]
    fn sweep_stale_removes_sessions_with_dead_client_pid() {
        let mut machine = StateMachine::default();
        machine.register("alive".into(), "/work/alpha".into(), Some(10), 100);
        machine.register("stale".into(), "/work/beta".into(), Some(20), 100);
        machine.register("unknown".into(), "/work/gamma".into(), None, 100);

        let removed = machine.sweep_stale(|pid| pid == 10);
        let snapshot = machine.snapshot(200);

        assert_eq!(removed, vec!["stale"]);
        assert_eq!(
            snapshot
                .sessions
                .iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["alive", "unknown"]
        );
    }
}
