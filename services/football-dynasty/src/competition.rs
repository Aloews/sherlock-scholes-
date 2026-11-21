//! Deterministic competition scheduling and fixture invariants.
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompetitionRules {
    pub double_round_robin: bool,
    pub days_between_rounds: u16,
    pub home_win_points: u8,
    pub draw_points: u8,
}
impl Default for CompetitionRules {
    fn default() -> Self {
        Self { double_round_robin: true, days_between_rounds: 7, home_win_points: 3, draw_points: 1 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScheduledFixture {
    pub matchday: u16,
    pub match_date: NaiveDate,
    pub home_team_id: Uuid,
    pub away_team_id: Uuid,
    pub leg: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompetitionError {
    TooFewTeams(usize),
    DuplicateTeam(Uuid),
    InvalidRoundInterval,
    TooManyRounds(usize),
}
impl std::fmt::Display for CompetitionError {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {
        match self {
            Self::TooFewTeams(n)=>write!(f,"competition needs at least two teams, got {n}"),
            Self::DuplicateTeam(id)=>write!(f,"duplicate team in competition: {id}"),
            Self::InvalidRoundInterval=>write!(f,"round interval must be at least one day"),
            Self::TooManyRounds(n)=>write!(f,"competition has too many matchdays: {n}"),
        }
    }
}
impl std::error::Error for CompetitionError {}

/// Circle-method schedule. Each team plays at most once per matchday.
/// Odd team counts receive a bye. The return leg reverses every home/away pair.
pub fn generate_round_robin(
    team_ids: &[Uuid],
    first_match_date: NaiveDate,
    rules: CompetitionRules,
) -> Result<Vec<ScheduledFixture>,CompetitionError> {
    if team_ids.len()<2 { return Err(CompetitionError::TooFewTeams(team_ids.len())); }
    if rules.days_between_rounds==0 { return Err(CompetitionError::InvalidRoundInterval); }
    let mut seen=BTreeSet::new();
    for id in team_ids {
        if !seen.insert(*id) { return Err(CompetitionError::DuplicateTeam(*id)); }
    }
    let mut rotation:Vec<Option<Uuid>>=team_ids.iter().copied().map(Some).collect();
    if rotation.len()%2==1 { rotation.push(None); }
    let first_leg_rounds=rotation.len()-1;
    let total_rounds=first_leg_rounds*if rules.double_round_robin {2} else {1};
    if total_rounds>38 { return Err(CompetitionError::TooManyRounds(total_rounds)); }
    let mut fixtures=Vec::with_capacity(team_ids.len()*(team_ids.len()-1)/2*if rules.double_round_robin {2}else{1});

    for round in 0..first_leg_rounds {
        let matchday=round+1;
        let match_date=first_match_date+Duration::days(i64::from(rules.days_between_rounds)*round as i64);
        for pair in 0..rotation.len()/2 {
            let left=rotation[pair];
            let right=rotation[rotation.len()-1-pair];
            if let (Some(a),Some(b))=(left,right) {
                let (home,away)=if (round+pair)%2==0 {(a,b)} else {(b,a)};
                fixtures.push(ScheduledFixture {
                    matchday:matchday as u16,match_date,home_team_id:home,away_team_id:away,leg:1,
                });
            }
        }
        // Keep the first participant fixed and rotate the rest clockwise.
        let last=rotation.pop().expect("rotation is non-empty");
        rotation.insert(1,last);
    }

    if rules.double_round_robin {
        let offset=first_leg_rounds;
        let first_leg=fixtures.clone();
        for fixture in first_leg {
            let matchday=offset+usize::from(fixture.matchday);
            fixtures.push(ScheduledFixture {
                matchday:matchday as u16,
                match_date:first_match_date+Duration::days(i64::from(rules.days_between_rounds)*(matchday-1) as i64),
                home_team_id:fixture.away_team_id,
                away_team_id:fixture.home_team_id,
                leg:2,
            });
        }
    }
    Ok(fixtures)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ids(n:u128)->Vec<Uuid>{(1..=n).map(Uuid::from_u128).collect()}
    #[test]
    fn four_team_double_round_robin_has_twelve_balanced_fixtures() {
        let teams=ids(4);
        let start=NaiveDate::from_ymd_opt(2026,1,3).unwrap();
        let fixtures=generate_round_robin(&teams,start,CompetitionRules::default()).unwrap();
        assert_eq!(fixtures.len(),12);
        assert_eq!(fixtures.iter().map(|f|f.matchday).max(),Some(6));
        assert_eq!(fixtures.iter().filter(|f|f.matchday==4).map(|f|f.match_date).next(),
            Some(start+Duration::days(21)));
        for team in &teams {
            assert_eq!(fixtures.iter().filter(|f|f.home_team_id==*team).count(),3);
            assert_eq!(fixtures.iter().filter(|f|f.away_team_id==*team).count(),3);
        }
        for round in 1..=6 {
            let round_fixtures:Vec<_>=fixtures.iter().filter(|f|f.matchday==round).collect();
            let participants:BTreeSet<_>=round_fixtures.iter().flat_map(|f|[f.home_team_id,f.away_team_id]).collect();
            assert_eq!(participants.len(),4);
        }
    }
    #[test]
    fn odd_team_count_assigns_a_bye_without_duplicate_round_appearances() {
        let teams=ids(5);
        let fixtures=generate_round_robin(&teams,NaiveDate::from_ymd_opt(2026,1,3).unwrap(),
            CompetitionRules{double_round_robin:false,..Default::default()}).unwrap();
        assert_eq!(fixtures.len(),10);
        for round in 1..=5 {
            let games=fixtures.iter().filter(|f|f.matchday==round).count();
            assert_eq!(games,2);
        }
    }
    #[test]
    fn duplicate_team_is_rejected() {
        let team=Uuid::from_u128(1);
        assert_eq!(generate_round_robin(&[team,team],NaiveDate::from_ymd_opt(2026,1,3).unwrap(),Default::default()),
            Err(CompetitionError::DuplicateTeam(team)));
    }
}
