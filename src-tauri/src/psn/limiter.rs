//! Conservative client-side rate limiter for PSN requests.
//!
//! Sony does not document limits for these endpoints. After a user's account was locked,
//! the budget is deliberately tiny: a minimum gap between requests and a hard cap of 20
//! requests per rolling hour. When the cap is reached requests are REFUSED (not queued),
//! and any HTTP 429 blocks further requests until the server's Retry-After passes.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    min_gap: Duration,
    window: Duration,
    max_in_window: usize,
    history: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

pub enum Admission {
    /// Request may proceed after waiting this long.
    Wait(Duration),
    /// Server asked us to back off; refuse until the deadline passes.
    Blocked(Duration),
}

impl RateLimiter {
    pub fn new(min_gap: Duration, window: Duration, max_in_window: usize) -> Self {
        Self { min_gap, window, max_in_window, history: VecDeque::new(), blocked_until: None }
    }

    pub fn default_psn() -> Self {
        Self::new(Duration::from_millis(800), Duration::from_secs(3600), 20)
    }

    /// Reserves a slot for a request at `now`, returning how long the caller must wait.
    pub fn admit(&mut self, now: Instant) -> Admission {
        if let Some(until) = self.blocked_until {
            if until > now {
                return Admission::Blocked(until - now);
            }
            self.blocked_until = None;
        }
        while let Some(front) = self.history.front() {
            if now.duration_since(*front) >= self.window {
                self.history.pop_front();
            } else {
                break;
            }
        }
        let mut start = now;
        if let Some(last) = self.history.back() {
            let earliest = *last + self.min_gap;
            if earliest > start {
                start = earliest;
            }
        }
        if self.history.len() >= self.max_in_window {
            // Budget exhausted: refuse rather than sleeping until a slot frees up.
            let free_at = self.history.front().map(|o| *o + self.window).unwrap_or(now);
            return Admission::Blocked(free_at.saturating_duration_since(now));
        }
        self.history.push_back(start);
        Admission::Wait(start.saturating_duration_since(now))
    }

    pub fn block_for(&mut self, now: Instant, duration: Duration) {
        self.blocked_until = Some(now + duration);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_min_gap() {
        let mut l = RateLimiter::new(Duration::from_millis(400), Duration::from_secs(60), 100);
        let t0 = Instant::now();
        assert!(matches!(l.admit(t0), Admission::Wait(d) if d.is_zero()));
        match l.admit(t0) {
            Admission::Wait(d) => assert_eq!(d, Duration::from_millis(400)),
            _ => panic!("expected wait"),
        }
    }

    #[test]
    fn refuses_once_the_hourly_budget_is_spent() {
        let mut l = RateLimiter::new(Duration::ZERO, Duration::from_secs(3600), 2);
        let t0 = Instant::now();
        l.admit(t0);
        l.admit(t0);
        match l.admit(t0) {
            Admission::Blocked(d) => assert_eq!(d, Duration::from_secs(3600)),
            _ => panic!("expected the request to be refused"),
        }
        assert!(matches!(l.admit(t0 + Duration::from_secs(3601)), Admission::Wait(_)));
    }

    #[test]
    fn default_budget_is_twenty_per_hour() {
        let mut l = RateLimiter::default_psn();
        let mut t = Instant::now();
        for _ in 0..20 {
            assert!(matches!(l.admit(t), Admission::Wait(_)));
            t += Duration::from_secs(1);
        }
        assert!(matches!(l.admit(t), Admission::Blocked(_)));
    }

    #[test]
    fn honours_server_backoff() {
        let mut l = RateLimiter::default_psn();
        let t0 = Instant::now();
        l.block_for(t0, Duration::from_secs(30));
        assert!(matches!(l.admit(t0), Admission::Blocked(_)));
        assert!(matches!(l.admit(t0 + Duration::from_secs(31)), Admission::Wait(_)));
    }
}
