use std::collections::{HashMap, VecDeque};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::protocol::PetCommand;

#[derive(Default)]
pub struct FocusBridge {
    state: Mutex<FocusBridgeState>,
    changed: Condvar,
}

#[derive(Default)]
struct FocusBridgeState {
    queues: HashMap<String, VecDeque<PetCommand>>,
    waiters: HashMap<String, usize>,
    recently_waiting_until: HashMap<String, Instant>,
}

const RECONNECT_GRACE: Duration = Duration::from_millis(1500);

impl FocusBridge {
    pub fn enqueue_focus(&self, session_id: String) -> bool {
        let mut state = self.state.lock().unwrap();
        if !can_deliver_soon(&mut state, &session_id) {
            return false;
        }

        state
            .queues
            .entry(session_id.clone())
            .or_default()
            .push_back(PetCommand::Focus { session_id });
        self.changed.notify_all();
        true
    }

    pub fn wait_command(&self, session_id: &str, timeout: Duration) -> PetCommand {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().unwrap();
        *state.waiters.entry(session_id.to_string()).or_default() += 1;

        loop {
            if let Some(queue) = state.queues.get_mut(session_id) {
                if let Some(command) = queue.pop_front() {
                    remove_waiter(&mut state, session_id);
                    return command;
                }
            }

            let now = Instant::now();
            if now >= deadline {
                remove_waiter(&mut state, session_id);
                return PetCommand::Noop;
            }

            let wait_for = deadline.saturating_duration_since(now);
            let (next_state, result) = self.changed.wait_timeout(state, wait_for).unwrap();
            state = next_state;
            if result.timed_out() {
                remove_waiter(&mut state, session_id);
                return PetCommand::Noop;
            }
        }
    }
}

fn can_deliver_soon(state: &mut FocusBridgeState, session_id: &str) -> bool {
    if state.waiters.get(session_id).copied().unwrap_or(0) > 0 {
        return true;
    }

    let now = Instant::now();
    state.recently_waiting_until.retain(|_, until| *until > now);
    state.recently_waiting_until.contains_key(session_id)
}

fn remove_waiter(state: &mut FocusBridgeState, session_id: &str) {
    if let Some(count) = state.waiters.get_mut(session_id) {
        *count = count.saturating_sub(1);
        if *count == 0 {
            state.waiters.remove(session_id);
            state
                .recently_waiting_until
                .insert(session_id.to_string(), Instant::now() + RECONNECT_GRACE);
        }
    }
}
