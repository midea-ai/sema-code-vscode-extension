use std::collections::{HashMap, VecDeque};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::protocol::PetCommand;

#[derive(Default)]
pub struct FocusBridge {
    queues: Mutex<HashMap<String, VecDeque<PetCommand>>>,
    waiters: Mutex<HashMap<String, usize>>,
    recently_waiting_until: Mutex<HashMap<String, Instant>>,
    changed: Condvar,
}

const RECONNECT_GRACE: Duration = Duration::from_millis(1500);

impl FocusBridge {
    pub fn enqueue_focus(&self, session_id: String) -> bool {
        if !self.can_deliver_soon(&session_id) {
            return false;
        }

        let mut queues = self.queues.lock().unwrap();
        queues
            .entry(session_id.clone())
            .or_default()
            .push_back(PetCommand::Focus { session_id });
        self.changed.notify_all();
        true
    }

    pub fn wait_command(&self, session_id: &str, timeout: Duration) -> PetCommand {
        let _guard = ActiveWaiter::new(self, session_id);
        let deadline = Instant::now() + timeout;
        let mut queues = self.queues.lock().unwrap();

        loop {
            if let Some(queue) = queues.get_mut(session_id) {
                if let Some(command) = queue.pop_front() {
                    return command;
                }
            }

            let now = Instant::now();
            if now >= deadline {
                return PetCommand::Noop;
            }

            let wait_for = deadline.saturating_duration_since(now);
            let (next_queues, result) = self.changed.wait_timeout(queues, wait_for).unwrap();
            queues = next_queues;
            if result.timed_out() {
                return PetCommand::Noop;
            }
        }
    }

    fn can_deliver_soon(&self, session_id: &str) -> bool {
        if self
            .waiters
            .lock()
            .unwrap()
            .get(session_id)
            .copied()
            .unwrap_or(0)
            > 0
        {
            return true;
        }

        let now = Instant::now();
        let mut recently_waiting_until = self.recently_waiting_until.lock().unwrap();
        recently_waiting_until.retain(|_, until| *until > now);
        recently_waiting_until.contains_key(session_id)
    }
}

struct ActiveWaiter<'a> {
    bridge: &'a FocusBridge,
    session_id: String,
}

impl<'a> ActiveWaiter<'a> {
    fn new(bridge: &'a FocusBridge, session_id: &str) -> Self {
        let mut waiters = bridge.waiters.lock().unwrap();
        *waiters.entry(session_id.to_string()).or_default() += 1;
        Self {
            bridge,
            session_id: session_id.to_string(),
        }
    }
}

impl Drop for ActiveWaiter<'_> {
    fn drop(&mut self) {
        let mut waiters = self.bridge.waiters.lock().unwrap();
        if let Some(count) = waiters.get_mut(&self.session_id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                waiters.remove(&self.session_id);
                self.bridge
                    .recently_waiting_until
                    .lock()
                    .unwrap()
                    .insert(self.session_id.clone(), Instant::now() + RECONNECT_GRACE);
            }
        }
    }
}
