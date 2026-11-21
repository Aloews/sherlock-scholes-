//! Deterministic, low-cost player-state intelligence for match simulation.
//! Persistent player state changes outcomes without scripted match events.

/// Converts a base attribute into its in-match effective value.
/// Fatigue reduces execution; morale provides a smaller bounded confidence modifier.
/// Integer arithmetic keeps results deterministic across platforms.
pub fn effective_attribute(base: u8, fatigue: u8, morale: u8) -> u8 {
    let fatigue_penalty = u16::from(fatigue.min(100)) * 35;
    let fatigue_factor = 10_000_u16.saturating_sub(fatigue_penalty).max(6_500);
    let morale_modifier = (i16::from(morale.min(100)) - 50) * 4;
    let adjusted = (u32::from(base.min(100)) * u32::from(fatigue_factor) / 10_000) as i16
        + morale_modifier;
    adjusted.clamp(1, 100) as u8
}

/// Estimates the physical cost of a pressing scheme over a ten-minute segment.
pub fn pressing_fatigue_cost(pressing: u8, stamina: u8) -> u8 {
    let intensity = u16::from(pressing.min(100));
    let endurance = u16::from(stamina.min(100));
    (1 + intensity.saturating_sub(endurance / 2) / 35).min(4) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fatigue_reduces_effective_output_and_morale_is_bounded() {
        assert!(effective_attribute(80, 80, 50) < effective_attribute(80, 5, 50));
        assert!(effective_attribute(80, 5, 90) > effective_attribute(80, 5, 50));
        assert_eq!(effective_attribute(0, 100, 0), 1);
        assert_eq!(effective_attribute(100, 0, 100), 100);
    }

    #[test]
    fn high_pressing_costs_more_than_conservative_pressing() {
        assert!(pressing_fatigue_cost(100, 50) > pressing_fatigue_cost(20, 80));
    }
}
