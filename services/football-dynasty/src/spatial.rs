//! Deterministic pitch geometry and event-derived spatial analytics.
//! Coordinates use a 0..=10_000 normalized pitch; x runs left-to-right,
//! y runs from the home goal line to the away goal line.

use serde::{Deserialize, Serialize};

pub const PITCH_MAX: u16 = 10_000;
pub const HEATMAP_BINS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PitchPoint {
    pub x: u16,
    pub y: u16,
}

impl PitchPoint {
    pub fn new(x: u16, y: u16) -> Self {
        Self { x: x.min(PITCH_MAX), y: y.min(PITCH_MAX) }
    }

    pub fn distance_squared(self, other: Self) -> u64 {
        let dx = i64::from(self.x) - i64::from(other.x);
        let dy = i64::from(self.y) - i64::from(other.y);
        (dx * dx + dy * dy) as u64
    }

    /// Move towards a target by at most max_step normalized coordinate units.
    /// Integer-only arithmetic makes movement replayable on every platform.
    pub fn move_towards(self, target: Self, max_step: u16) -> Self {
        let dx = i64::from(target.x) - i64::from(self.x);
        let dy = i64::from(target.y) - i64::from(self.y);
        let distance_sq = (dx * dx + dy * dy) as u64;
        if distance_sq == 0 || max_step == 0 { return self; }
        let root = integer_sqrt(distance_sq).max(1);
        let distance = if root * root < distance_sq { root + 1 } else { root };
        if distance <= u64::from(max_step) { return target; }
        let step = i64::from(max_step);
        let next_x = i64::from(self.x) + dx * step / distance as i64;
        let next_y = i64::from(self.y) + dy * step / distance as i64;
        Self::new(next_x.clamp(0, i64::from(PITCH_MAX)) as u16,
                  next_y.clamp(0, i64::from(PITCH_MAX)) as u16)
    }

    /// True when this point is within a defender's pressure radius.
    pub fn under_pressure(self, defender: Self, radius: u16) -> bool {
        self.distance_squared(defender) <= u64::from(radius) * u64::from(radius)
    }

    /// Tests whether a defender intersects a pass corridor of the given half-width.
    /// The comparison is integer-only and includes both corridor endpoints.
    pub fn blocks_passing_lane(self, target: Self, defender: Self, half_width: u16) -> bool {
        let ax = i64::from(self.x);
        let ay = i64::from(self.y);
        let dx = i64::from(target.x) - ax;
        let dy = i64::from(target.y) - ay;
        let px = i64::from(defender.x) - ax;
        let py = i64::from(defender.y) - ay;
        let length_sq = dx * dx + dy * dy;
        let radius_sq = i64::from(half_width) * i64::from(half_width);
        if length_sq == 0 {
            return self.distance_squared(defender) <= radius_sq as u64;
        }
        let projection = px * dx + py * dy;
        if projection <= 0 {
            return self.distance_squared(defender) <= radius_sq as u64;
        }
        if projection >= length_sq {
            return target.distance_squared(defender) <= radius_sq as u64;
        }
        let cross = px * dy - py * dx;
        cross * cross <= radius_sq * length_sq
    }

    pub fn zone(self) -> PitchZone {
        let x = usize::from(self.x) * 3 / (usize::from(PITCH_MAX) + 1);
        let y = usize::from(self.y) * 3 / (usize::from(PITCH_MAX) + 1);
        match (y.min(2), x.min(2)) {
            (0, 0) => PitchZone::HomeLeft,
            (0, 1) => PitchZone::HomeCentre,
            (0, 2) => PitchZone::HomeRight,
            (1, 0) => PitchZone::MiddleLeft,
            (1, 1) => PitchZone::MiddleCentre,
            (1, 2) => PitchZone::MiddleRight,
            (2, 0) => PitchZone::AwayLeft,
            (2, 1) => PitchZone::AwayCentre,
            _ => PitchZone::AwayRight,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PitchZone {
    HomeLeft, HomeCentre, HomeRight,
    MiddleLeft, MiddleCentre, MiddleRight,
    AwayLeft, AwayCentre, AwayRight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Heatmap {
    pub bins: [[u32; HEATMAP_BINS]; HEATMAP_BINS],
    pub samples: u32,
}

impl Default for Heatmap {
    fn default() -> Self { Self { bins: [[0; HEATMAP_BINS]; HEATMAP_BINS], samples: 0 } }
}

impl Heatmap {
    pub fn record(&mut self, point: PitchPoint) {
        let x = (usize::from(point.x) * HEATMAP_BINS / (usize::from(PITCH_MAX) + 1)).min(HEATMAP_BINS - 1);
        let y = (usize::from(point.y) * HEATMAP_BINS / (usize::from(PITCH_MAX) + 1)).min(HEATMAP_BINS - 1);
        self.bins[y][x] = self.bins[y][x].saturating_add(1);
        self.samples = self.samples.saturating_add(1);
    }

    pub fn peak(&self) -> Option<(usize, usize, u32)> {
        let mut peak: Option<(usize, usize, u32)> = None;
        for (y, row) in self.bins.iter().enumerate() {
            for (x, count) in row.iter().copied().enumerate() {
                if count > peak.map_or(0, |(_, _, value)| value) {
                    peak = Some((x, y, count));
                }
            }
        }
        peak
    }
}

fn integer_sqrt(value: u64) -> u64 {
    if value < 2 { return value; }
    let mut x = value;
    let mut y = x.div_ceil(2);
    while y < x { x = y; y = (x + value / x) / 2; }
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinates_are_bounded_and_zoned() {
        assert_eq!(PitchPoint::new(u16::MAX, 0), PitchPoint { x: PITCH_MAX, y: 0 });
        assert_eq!(PitchPoint::new(0, 0).zone(), PitchZone::HomeLeft);
        assert_eq!(PitchPoint::new(5_000, 5_000).zone(), PitchZone::MiddleCentre);
        assert_eq!(PitchPoint::new(10_000, 10_000).zone(), PitchZone::AwayRight);
    }

    #[test]
    fn movement_is_bounded_and_reaches_nearby_target() {
        let start = PitchPoint::new(1_000, 1_000);
        let target = PitchPoint::new(9_000, 1_000);
        let moved = start.move_towards(target, 500);
        assert!(start.distance_squared(moved) <= 250_000);
        assert_eq!(moved, PitchPoint::new(1_500, 1_000));
        assert_eq!(moved.move_towards(PitchPoint::new(1_600, 1_000), 500), PitchPoint::new(1_600, 1_000));
    }

    #[test]
    fn heatmap_counts_events_and_returns_peak() {
        let mut map = Heatmap::default();
        map.record(PitchPoint::new(1_000, 1_000));
        map.record(PitchPoint::new(900, 900));
        map.record(PitchPoint::new(9_000, 9_000));
        assert_eq!(map.samples, 3);
        assert_eq!(map.peak(), Some((0, 0, 2)));
    }

    #[test]
    fn pressure_and_passing_lane_geometry_are_spatially_consistent() {
        let passer = PitchPoint::new(1_000, 5_000);
        let receiver = PitchPoint::new(9_000, 5_000);
        let central_defender = PitchPoint::new(5_000, 5_100);
        let wide_defender = PitchPoint::new(5_000, 6_000);
        assert!(central_defender.under_pressure(PitchPoint::new(5_000, 5_000), 100));
        assert!(passer.blocks_passing_lane(receiver, central_defender, 150));
        assert!(!passer.blocks_passing_lane(receiver, wide_defender, 150));
    }

    #[test]
    fn geometry_is_symmetric() {
        let a = PitchPoint::new(100, 200);
        let b = PitchPoint::new(900, 700);
        assert_eq!(a.distance_squared(b), b.distance_squared(a));
        assert_eq!(a.distance_squared(a), 0);
    }
}
