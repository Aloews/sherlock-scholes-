//! Player-aware match simulation. Pure, deterministic and independent of persistence.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    match_intelligence::effective_attribute,
    engine::{MatchRules, TeamProfile},
    squad::{build_team_profile, Formation, Lineup, Player, Position, SquadError, TacticalPlan},
};

const SCALE: u32 = 1_000_000;
pub const MAX_SUBSTITUTIONS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchSquad {
    pub team_id: Uuid,
    pub starting: Lineup,
    pub bench: Vec<Player>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubstitutionPlan {
    pub minute: u8,
    pub outgoing_player_id: Uuid,
    pub incoming_player_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayerMatchEventKind {
    Shot,
    Goal,
    Save,
    Miss,
    Substitution,
    HalfTime,
    FullTime,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerMatchEvent {
    pub sequence: u16,
    pub minute: u8,
    pub kind: PlayerMatchEventKind,
    pub team_id: Option<Uuid>,
    /// Scorer for Goal; outgoing player for Substitution.
    pub player_id: Option<Uuid>,
    /// Assist provider for Goal; incoming player for Substitution.
    pub related_player_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerMatchResult {
    pub engine_version: u32,
    pub match_id: Uuid,
    pub home_team_id: Uuid,
    pub away_team_id: Uuid,
    pub home_goals: u8,
    pub away_goals: u8,
    pub home_xg_milli: u16,
    pub away_xg_milli: u16,
    pub events: Vec<PlayerMatchEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlayerMatchError {
    SameTeam,
    InvalidMinutes(u8),
    InvalidBenchSize(usize),
    TooManySubstitutions(usize),
    InvalidSubstitutionMinute(u8),
    DuplicateSubstitutionPlayer(Uuid),
    UnknownSubstitutionPlayer(Uuid),
    PositionMismatch,
    Squad(SquadError),
}
impl std::fmt::Display for PlayerMatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SameTeam => write!(f, "home and away teams must differ"),
            Self::InvalidMinutes(v) => write!(f, "invalid match duration: {v}"),
            Self::InvalidBenchSize(v) => write!(f, "bench must contain at most 9 players, got {v}"),
            Self::TooManySubstitutions(v) => write!(f, "at most 5 substitutions are allowed, got {v}"),
            Self::InvalidSubstitutionMinute(v) => write!(f, "invalid substitution minute: {v}"),
            Self::DuplicateSubstitutionPlayer(id) => write!(f, "player used more than once in substitution plan: {id}"),
            Self::UnknownSubstitutionPlayer(id) => write!(f, "substitution player is not in the XI/bench: {id}"),
            Self::PositionMismatch => write!(f, "substitute must replace a player in the same position"),
            Self::Squad(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for PlayerMatchError {}
impl From<SquadError> for PlayerMatchError {
    fn from(value: SquadError) -> Self { Self::Squad(value) }
}

fn draw(seed: u64, match_id: Uuid, minute: u8, team_id: Uuid, salt: u8) -> u32 {
    let mut hash = Sha256::new();
    hash.update(seed.to_be_bytes());
    hash.update(match_id.as_bytes());
    hash.update(team_id.as_bytes());
    hash.update([minute, salt]);
    let digest = hash.finalize();
    u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % SCALE
}

fn chance_probability(attack: &TeamProfile, defence: &TeamProfile, home: u16, tactics: TacticalPlan) -> u32 {
    (100_000_i32
        + i32::from(attack.midfield) * 600
        + i32::from(attack.attack) * 250
        - i32::from(defence.midfield) * 300
        + (i32::from(tactics.tempo)-50)*500
        + (i32::from(tactics.width)-50)*100
        + i32::from(home))
        .clamp(50_000,350_000) as u32
}

fn shot_probability(shooter: &Player, attack: &TeamProfile, defence: &TeamProfile) -> u32 {
    (70_000_i32
        + i32::from(effective_attribute(shooter.attributes.shooting, shooter.fatigue, shooter.morale)) * 900
        + i32::from(attack.attack) * 250
        - i32::from(defence.goalkeeper) * 700
        - i32::from(defence.defence) * 150)
        .clamp(20_000,450_000) as u32
}

fn select_player(players: &[Player], value: u32, scorer: bool) -> Option<Uuid> {
    let weight = |p: &Player| -> u32 {
        let base = if scorer {
            u32::from(effective_attribute(p.attributes.shooting, p.fatigue, p.morale)) + 1
        } else {
            u32::from(effective_attribute(p.attributes.passing, p.fatigue, p.morale)) + 1
        };
        let positional = if scorer {
            match p.position { Position::Forward => 5, Position::Midfielder => 3, _ => 1 }
        } else {
            match p.position { Position::Midfielder => 5, Position::Defender => 2, _ => 3 }
        };
        base * positional
    };
    let total: u32 = players.iter().map(weight).sum();
    if total == 0 { return None; }
    let mut needle = value % total;
    for player in players {
        let current = weight(player);
        if needle < current { return Some(player.id); }
        needle -= current;
    }
    players.last().map(|p| p.id)
}

fn profile(team_id: Uuid, players: &[Player], formation: Formation, tactics: TacticalPlan) -> Result<TeamProfile, PlayerMatchError> {
    Ok(build_team_profile(team_id, &Lineup {
        starters: players.to_vec(), formation, tactics,
    })?)
}

fn validate_squad(squad: &MatchSquad) -> Result<(), PlayerMatchError> {
    if squad.bench.len() > 9 { return Err(PlayerMatchError::InvalidBenchSize(squad.bench.len())); }
    let mut ids = std::collections::BTreeSet::new();
    for p in squad.starting.starters.iter().chain(squad.bench.iter()) {
        if !ids.insert(p.id) {
            return Err(PlayerMatchError::DuplicateSubstitutionPlayer(p.id));
        }
    }
    // The XI validator checks position counts, attributes, injuries and suspensions.
    build_team_profile(squad.team_id, &squad.starting)?;
    for p in &squad.bench {
        if p.injured || p.suspended { return Err(PlayerMatchError::UnknownSubstitutionPlayer(p.id)); }
        let a = p.attributes;
        if [a.pace,a.shooting,a.passing,a.defending,a.physical,a.goalkeeping,a.stamina,p.morale,p.fatigue]
            .iter().any(|v| *v > 100) {
            return Err(PlayerMatchError::Squad(SquadError::AttributeOutOfRange(p.id)));
        }
    }
    Ok(())
}

fn validate_plan(
    squad: &MatchSquad,
    plans: &[SubstitutionPlan],
    minutes: u8,
) -> Result<(), PlayerMatchError> {
    if plans.len() > MAX_SUBSTITUTIONS {
        return Err(PlayerMatchError::TooManySubstitutions(plans.len()));
    }
    let starters: std::collections::BTreeMap<_,_> = squad.starting.starters.iter().map(|p|(p.id,p)).collect();
    let bench: std::collections::BTreeMap<_,_> = squad.bench.iter().map(|p|(p.id,p)).collect();
    let mut used = std::collections::BTreeSet::new();
    for plan in plans {
        if plan.minute == 0 || plan.minute > minutes {
            return Err(PlayerMatchError::InvalidSubstitutionMinute(plan.minute));
        }
        if !used.insert(plan.outgoing_player_id) || !used.insert(plan.incoming_player_id) {
            return Err(PlayerMatchError::DuplicateSubstitutionPlayer(plan.outgoing_player_id));
        }
        let outgoing = starters.get(&plan.outgoing_player_id)
            .ok_or(PlayerMatchError::UnknownSubstitutionPlayer(plan.outgoing_player_id))?;
        let incoming = bench.get(&plan.incoming_player_id)
            .ok_or(PlayerMatchError::UnknownSubstitutionPlayer(plan.incoming_player_id))?;
        if outgoing.position != incoming.position { return Err(PlayerMatchError::PositionMismatch); }
    }
    Ok(())
}

/// Simulates a match with persisted player identities, scorer/assist attribution and
/// caller-specified legal substitutions. Inputs are immutable; replay is exact.
pub fn simulate_player_match(
    seed: u64,
    match_id: Uuid,
    home: &MatchSquad,
    away: &MatchSquad,
    rules: MatchRules,
    home_substitutions: &[SubstitutionPlan],
    away_substitutions: &[SubstitutionPlan],
) -> Result<PlayerMatchResult, PlayerMatchError> {
    if home.team_id == away.team_id { return Err(PlayerMatchError::SameTeam); }
    if !(1..=120).contains(&rules.minutes) { return Err(PlayerMatchError::InvalidMinutes(rules.minutes)); }
    validate_squad(home)?;
    validate_squad(away)?;
    validate_plan(home, home_substitutions, rules.minutes)?;
    validate_plan(away, away_substitutions, rules.minutes)?;

    let mut home_active = home.starting.starters.clone();
    let mut away_active = away.starting.starters.clone();
    let mut home_bench = home.bench.clone();
    let mut away_bench = away.bench.clone();
    let mut home_goals = 0_u8;
    let mut away_goals = 0_u8;
    let (mut home_xg, mut away_xg) = (0_u32, 0_u32);
    let mut events = Vec::new();

    for minute in 1..=rules.minutes {
        for (team, active, bench, plans) in [
            (home, &mut home_active, &mut home_bench, home_substitutions),
            (away, &mut away_active, &mut away_bench, away_substitutions),
        ] {
            for plan in plans.iter().filter(|p| p.minute == minute) {
                let outgoing_index = active.iter().position(|p| p.id == plan.outgoing_player_id)
                    .ok_or(PlayerMatchError::UnknownSubstitutionPlayer(plan.outgoing_player_id))?;
                let incoming_index = bench.iter().position(|p| p.id == plan.incoming_player_id)
                    .ok_or(PlayerMatchError::UnknownSubstitutionPlayer(plan.incoming_player_id))?;
                let outgoing = active.remove(outgoing_index);
                let incoming = bench.remove(incoming_index);
                events.push(PlayerMatchEvent {
                    sequence: events.len() as u16,
                    minute,
                    kind: PlayerMatchEventKind::Substitution,
                    team_id: Some(team.team_id),
                    player_id: Some(outgoing.id),
                    related_player_id: Some(incoming.id),
                });
                active.push(incoming);
            }
        }

        if minute == rules.minutes / 2 {
            events.push(PlayerMatchEvent {
                sequence: events.len() as u16, minute, kind: PlayerMatchEventKind::HalfTime,
                team_id: None, player_id: None, related_player_id: None,
            });
        }

        if minute % 10 == 0 {
            for (active, tactics) in [
                (&mut home_active, home.starting.tactics),
                (&mut away_active, away.starting.tactics),
            ] {
                for player in active.iter_mut() {
                    let base_cost = ((100_u16 - u16::from(player.attributes.stamina)) / 25).max(1) as u8;
                    let pressing_cost = crate::match_intelligence::pressing_fatigue_cost(
                        tactics.pressing, player.attributes.stamina,
                    );
                    let fatigue_gain = base_cost.saturating_add(pressing_cost.saturating_sub(1));
                    player.fatigue = player.fatigue.saturating_add(fatigue_gain).min(100);
                }
            }
        }

        let home_profile = profile(home.team_id, &home_active, home.starting.formation, home.starting.tactics)?;
        let away_profile = profile(away.team_id, &away_active, away.starting.formation, away.starting.tactics)?;
        let home_chance = chance_probability(&home_profile,&away_profile,rules.home_advantage_milli,home.starting.tactics);
        let away_chance = chance_probability(&away_profile,&home_profile,0,away.starting.tactics);

        if home_goals < 12 && draw(seed,match_id,minute,home.team_id,1)<home_chance {
            if let Some(shooter_id)=select_player(&home_active,draw(seed,match_id,minute,home.team_id,2),true) {
                let shooter=home_active.iter().find(|p|p.id==shooter_id).expect("selected home shooter");
                let goal_probability=shot_probability(shooter,&home_profile,&away_profile);
                home_xg+=goal_probability/1_000;
                events.push(PlayerMatchEvent {
                    sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Shot,
                    team_id:Some(home.team_id),player_id:Some(shooter_id),related_player_id:None,
                });
                if draw(seed,match_id,minute,home.team_id,3)<goal_probability {
                    home_goals+=1;
                    let assist_id=if draw(seed,match_id,minute,home.team_id,4)<700_000 {
                        let candidates:Vec<_>=home_active.iter().filter(|p|p.id!=shooter_id).cloned().collect();
                        select_player(&candidates,draw(seed,match_id,minute,home.team_id,5),false)
                    } else {None};
                    events.push(PlayerMatchEvent {
                        sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Goal,
                        team_id:Some(home.team_id),player_id:Some(shooter_id),related_player_id:assist_id,
                    });
                } else if draw(seed,match_id,minute,home.team_id,6)<500_000 {
                    let keeper=away_active.iter().find(|p|p.position==Position::Goalkeeper).map(|p|p.id);
                    events.push(PlayerMatchEvent {
                        sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Save,
                        team_id:Some(away.team_id),player_id:keeper,related_player_id:Some(shooter_id),
                    });
                } else {
                    events.push(PlayerMatchEvent {
                        sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Miss,
                        team_id:Some(home.team_id),player_id:Some(shooter_id),related_player_id:None,
                    });
                }
            }
        }
        if away_goals < 12 && draw(seed,match_id,minute,away.team_id,11)<away_chance {
            if let Some(shooter_id)=select_player(&away_active,draw(seed,match_id,minute,away.team_id,12),true) {
                let shooter=away_active.iter().find(|p|p.id==shooter_id).expect("selected away shooter");
                let goal_probability=shot_probability(shooter,&away_profile,&home_profile);
                away_xg+=goal_probability/1_000;
                events.push(PlayerMatchEvent {
                    sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Shot,
                    team_id:Some(away.team_id),player_id:Some(shooter_id),related_player_id:None,
                });
                if draw(seed,match_id,minute,away.team_id,13)<goal_probability {
                    away_goals+=1;
                    let assist_id=if draw(seed,match_id,minute,away.team_id,14)<700_000 {
                        let candidates:Vec<_>=away_active.iter().filter(|p|p.id!=shooter_id).cloned().collect();
                        select_player(&candidates,draw(seed,match_id,minute,away.team_id,15),false)
                    } else {None};
                    events.push(PlayerMatchEvent {
                        sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Goal,
                        team_id:Some(away.team_id),player_id:Some(shooter_id),related_player_id:assist_id,
                    });
                } else if draw(seed,match_id,minute,away.team_id,16)<500_000 {
                    let keeper=home_active.iter().find(|p|p.position==Position::Goalkeeper).map(|p|p.id);
                    events.push(PlayerMatchEvent {
                        sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Save,
                        team_id:Some(home.team_id),player_id:keeper,related_player_id:Some(shooter_id),
                    });
                } else {
                    events.push(PlayerMatchEvent {
                        sequence:events.len() as u16,minute,kind:PlayerMatchEventKind::Miss,
                        team_id:Some(away.team_id),player_id:Some(shooter_id),related_player_id:None,
                    });
                }
            }
        }
    }
    events.push(PlayerMatchEvent {
        sequence: events.len() as u16, minute: rules.minutes, kind: PlayerMatchEventKind::FullTime,
        team_id: None, player_id: None, related_player_id: None,
    });
    Ok(PlayerMatchResult {
        engine_version: crate::engine::ENGINE_VERSION,
        match_id,
        home_team_id: home.team_id,
        away_team_id: away.team_id,
        home_goals,
        away_goals,
        home_xg_milli: home_xg.min(u16::MAX as u32) as u16,
        away_xg_milli: away_xg.min(u16::MAX as u32) as u16,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::squad::{PlayerAttributes, Position};

    fn player(id: u128, position: Position) -> Player {
        Player { id: Uuid::from_u128(id), position,
            attributes: PlayerAttributes { pace:70, shooting:70, passing:70, defending:70,
                physical:70, goalkeeping:70, stamina:75 },
            morale:70, fatigue:5, injured:false, suspended:false }
    }
    fn squad(offset: u128) -> MatchSquad {
        let mut starters=vec![player(offset+1,Position::Goalkeeper)];
        starters.extend((2..=5).map(|n|player(offset+n,Position::Defender)));
        starters.extend((6..=8).map(|n|player(offset+n,Position::Midfielder)));
        starters.extend((9..=11).map(|n|player(offset+n,Position::Forward)));
        let bench=vec![player(offset+12,Position::Forward),player(offset+13,Position::Midfielder)];
        MatchSquad { team_id:Uuid::from_u128(offset+100), starting:Lineup {
            starters, formation:Formation::FOUR_THREE_THREE, tactics:TacticalPlan::default()
        }, bench }
    }
    #[test]
    fn player_match_replays_with_goal_attribution() {
        let (home,away)=(squad(0),squad(1000));
        let a=simulate_player_match(42,Uuid::from_u128(9000),&home,&away,MatchRules::default(),&[],&[]).unwrap();
        let b=simulate_player_match(42,Uuid::from_u128(9000),&home,&away,MatchRules::default(),&[],&[]).unwrap();
        assert_eq!(a,b);
        assert!(a.events.iter().filter(|e|e.kind==PlayerMatchEventKind::Shot).count() >= a.events.iter().filter(|e|e.kind==PlayerMatchEventKind::Goal).count());
        for event in a.events.iter().filter(|e|e.kind==PlayerMatchEventKind::Goal) {
            assert!(event.player_id.is_some());
            assert!(event.related_player_id != event.player_id);
        }
    }
    #[test]
    fn legal_substitution_uses_bench_player_and_records_both_ids() {
        let (home,away)=(squad(0),squad(1000));
        let plan=SubstitutionPlan { minute:60, outgoing_player_id:Uuid::from_u128(9), incoming_player_id:Uuid::from_u128(12) };
        let result=simulate_player_match(42,Uuid::from_u128(9000),&home,&away,MatchRules::default(),&[plan],&[]).unwrap();
        assert!(result.events.iter().any(|e|e.kind==PlayerMatchEventKind::Substitution
            && e.player_id==Some(plan.outgoing_player_id) && e.related_player_id==Some(plan.incoming_player_id)));
    }
    #[test]
    fn tactical_tempo_changes_expected_chances() {
        let (mut fast,away)=(squad(0),squad(1000));
        let mut slow=fast.clone();
        fast.starting.tactics.tempo=100;
        slow.starting.tactics.tempo=0;
        let fast_result=simulate_player_match(77,Uuid::from_u128(9001),&fast,&away,MatchRules::default(),&[],&[]).unwrap();
        let slow_result=simulate_player_match(77,Uuid::from_u128(9001),&slow,&away,MatchRules::default(),&[],&[]).unwrap();
        assert!(fast_result.home_xg_milli>slow_result.home_xg_milli);
    }

    #[test]
    fn illegal_position_substitution_is_rejected() {
        let (home,away)=(squad(0),squad(1000));
        let plan=SubstitutionPlan { minute:60, outgoing_player_id:Uuid::from_u128(9), incoming_player_id:Uuid::from_u128(13) };
        assert_eq!(simulate_player_match(42,Uuid::from_u128(9000),&home,&away,MatchRules::default(),&[plan],&[]).unwrap_err(),
            PlayerMatchError::PositionMismatch);
    }
}
