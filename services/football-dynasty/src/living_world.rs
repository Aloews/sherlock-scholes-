use serde::{Deserialize, Serialize};

/// Stable event identity and causal parentage for the first living-world slice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldIncident {
    pub id: String,
    pub kind: IncidentKind,
    pub day: u32,
    pub location: String,
    pub witnesses: Vec<String>,
    pub status: IncidentStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum IncidentKind {
    TheftNearClub,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum IncidentStatus {
    PlayerAware,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayerResponse {
    HelpVictim,
    ReportIncident,
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldReaction {
    WitnessSharesIntervention,
    VictimTrustsPlayer,
    LocalNewsFollowUp,
    PoliceInvestigationOpened,
    NoImmediateReaction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldFact {
    pub key: String,
    pub value: i32,
    pub source_event_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelayedConsequence {
    pub event_id: String,
    pub due_day: u32,
    pub kind: DelayedKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DelayedKind {
    NewsFollowUp,
    WitnessReport,
    InvestigationUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldSliceResult {
    pub incident: WorldIncident,
    pub response: PlayerResponse,
    pub immediate_reactions: Vec<WorldReaction>,
    pub facts: Vec<WorldFact>,
    pub delayed: Vec<DelayedConsequence>,
}

/// Resolve player action with deterministic knowledge-gated witness reactions.
/// This pure core is replayable and intentionally uses no random side effects.
pub fn resolve_incident(incident: WorldIncident, response: PlayerResponse) -> WorldSliceResult {
    let source_id = incident.id.clone();
    let witness_count = incident.witnesses.len();
    let mut reactions = Vec::new();
    let mut facts = Vec::new();
    let mut delayed = Vec::new();

    match &response {
        PlayerResponse::HelpVictim => {
            facts.push(WorldFact { key: "player_public_help".into(), value: 1, source_event_id: source_id.clone() });
            facts.push(WorldFact { key: "victim_trust".into(), value: 2, source_event_id: source_id.clone() });
            reactions.push(WorldReaction::VictimTrustsPlayer);
            if witness_count > 0 {
                reactions.push(WorldReaction::WitnessSharesIntervention);
                delayed.push(DelayedConsequence { event_id: source_id.clone(), due_day: incident.day.saturating_add(2), kind: DelayedKind::NewsFollowUp });
            }
        }
    PlayerResponse::ReportIncident => {
            facts.push(WorldFact { key: "incident_reported".into(), value: 1, source_event_id: source_id.clone() });
            reactions.push(WorldReaction::PoliceInvestigationOpened);
            delayed.push(DelayedConsequence { event_id: source_id.clone(), due_day: incident.day.saturating_add(1), kind: DelayedKind::InvestigationUpdate });
        }
        PlayerResponse::Ignore => {
            facts.push(WorldFact { key: "player_ignored_incident".into(), value: 1, source_event_id: source_id.clone() });
            reactions.push(WorldReaction::NoImmediateReaction);
            if witness_count > 0 {
                delayed.push(DelayedConsequence { event_id: source_id.clone(), due_day: incident.day.saturating_add(3), kind: DelayedKind::WitnessReport });
            }
        }
    }

    let mut resolved_incident = incident;
    resolved_incident.status = IncidentStatus::Resolved;
    WorldSliceResult {
        incident: resolved_incident,
        response,
        immediate_reactions: reactions,
        facts,
        delayed,
    }
}

/// Resolve a delayed consequence only after its scheduled in-game day.
pub fn resolve_delayed(consequence: &DelayedConsequence, current_day: u32) -> Option<WorldReaction> {
    if current_day < consequence.due_day { return None; }
    Some(match &consequence.kind {
        DelayedKind::NewsFollowUp => WorldReaction::LocalNewsFollowUp,
        DelayedKind::WitnessReport => WorldReaction::WitnessSharesIntervention,
        DelayedKind::InvestigationUpdate => WorldReaction::PoliceInvestigationOpened,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn incident(day: u32, witnesses: Vec<&str>) -> WorldIncident {
        WorldIncident {
            id: "incident-001".to_string(),
            kind: IncidentKind::TheftNearClub,
            day,
            location: "club-district".to_string(),
            witnesses: witnesses.into_iter().map(str::to_owned).collect(),
            status: IncidentStatus::PlayerAware,
        }
    }

    #[test]
    fn helping_with_witnesses_creates_public_and_delayed_reactions() {
        let result = resolve_incident(incident(10, vec!["npc-a"]), PlayerResponse::HelpVictim);
        assert!(result.immediate_reactions.contains(&WorldReaction::VictimTrustsPlayer));
        assert!(result.immediate_reactions.contains(&WorldReaction::WitnessSharesIntervention));
        assert_eq!(result.delayed[0].due_day, 12);
        assert_eq!(resolve_delayed(&result.delayed[0], 11), None);
        assert_eq!(resolve_delayed(&result.delayed[0], 12), Some(WorldReaction::LocalNewsFollowUp));
    }

    #[test]
    fn no_witness_means_no_publicity_chain() {
        let result = resolve_incident(incident(5, vec![]), PlayerResponse::HelpVictim);
        assert!(!result.immediate_reactions.contains(&WorldReaction::WitnessSharesIntervention));
        assert!(result.delayed.is_empty());
    }

    #[test]
    fn reporting_opens_investigation_and_delays_update() {
        let result = resolve_incident(incident(4, vec![]), PlayerResponse::ReportIncident);
        assert_eq!(result.delayed[0].due_day, 5);
        assert_eq!(resolve_delayed(&result.delayed[0], 4), None);
        assert_eq!(resolve_delayed(&result.delayed[0], 5), Some(WorldReaction::PoliceInvestigationOpened));
    }

    #[test]
    fn ignore_can_be_reported_later_by_a_witness() {
        let result = resolve_incident(incident(7, vec!["npc-b"]), PlayerResponse::Ignore);
        assert_eq!(result.delayed[0].due_day, 10);
        assert_eq!(resolve_delayed(&result.delayed[0], 10), Some(WorldReaction::WitnessSharesIntervention));
    }

    #[test]
    fn delayed_consequence_does_not_fire_before_due_day() {
        let result = resolve_incident(incident(2, vec!["npc-d"]), PlayerResponse::Ignore);
        assert!(resolve_delayed(&result.delayed[0], 4).is_none());
        assert!(resolve_delayed(&result.delayed[0], 5).is_some());
    }

    #[test]
    fn same_input_is_replayable() {
        let first = resolve_incident(incident(9, vec!["npc-c"]), PlayerResponse::HelpVictim);
        let second = resolve_incident(incident(9, vec!["npc-c"]), PlayerResponse::HelpVictim);
        assert_eq!(first, second);
    }
}
