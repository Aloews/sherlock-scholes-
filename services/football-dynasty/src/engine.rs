//! Pure deterministic football simulation. No I/O, clocks, or LLM state.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use uuid::Uuid;

pub const ENGINE_VERSION: u32 = 1;
const SCALE: u32 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamProfile {
    pub id: Uuid, pub attack: u8, pub midfield: u8, pub defence: u8,
    pub goalkeeper: u8, pub morale: u8, pub fatigue: u8,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchRules { pub minutes: u8, pub home_advantage_milli: u16 }
impl Default for MatchRules {
    fn default() -> Self { Self { minutes: 90, home_advantage_milli: 4_000 } }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchEventKind { Goal, HalfTime, FullTime }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchEvent { pub sequence: u16, pub minute: u8, pub kind: MatchEventKind, pub team_id: Option<Uuid> }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchResult {
    pub engine_version: u32, pub match_id: Uuid, pub home_team_id: Uuid, pub away_team_id: Uuid,
    pub home_goals: u8, pub away_goals: u8, pub home_xg_milli: u16, pub away_xg_milli: u16,
    pub events: Vec<MatchEvent>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError { SameTeam, InvalidMinutes(u8), RatingOutOfRange(&'static str, u8), SelfFixture }
impl std::fmt::Display for EngineError {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {
        match self { Self::SameTeam=>write!(f,"same team"), Self::InvalidMinutes(v)=>write!(f,"invalid minutes: {v}"),
            Self::RatingOutOfRange(k,v)=>write!(f,"{k} out of range: {v}"), Self::SelfFixture=>write!(f,"fixture cannot contain the same team twice") }
    }
}
impl std::error::Error for EngineError {}

fn validate(t:&TeamProfile)->Result<(),EngineError>{
    for (k,v) in [("attack",t.attack),("midfield",t.midfield),("defence",t.defence),
        ("goalkeeper",t.goalkeeper),("morale",t.morale),("fatigue",t.fatigue)] {
        if v>100 { return Err(EngineError::RatingOutOfRange(k,v)); }
    } Ok(())
}
fn probability(a:&TeamProfile,d:&TeamProfile,home:u16)->u32 {
    (8_000_i32+i32::from(a.attack)*200+i32::from(a.midfield)*100
        -i32::from(d.defence)*80-i32::from(d.goalkeeper)*80+i32::from(a.morale)*30
        -i32::from(a.fatigue)*80+i32::from(home)).clamp(2_000,90_000) as u32
}
fn roll(seed:u64,mid:Uuid,minute:u8,tid:Uuid,side:u8)->u32{
    let mut h=Sha256::new(); h.update(seed.to_be_bytes()); h.update(mid.as_bytes());
    h.update(tid.as_bytes()); h.update([minute,side]); let b=h.finalize();
    u32::from_be_bytes([b[0],b[1],b[2],b[3]])%SCALE
}
/// Stable replay: identical seed, fixture, inputs and rules produce identical events.
pub fn simulate_match(seed:u64,match_id:Uuid,home:&TeamProfile,away:&TeamProfile,rules:MatchRules)->Result<MatchResult,EngineError>{
    if home.id==away.id{return Err(EngineError::SameTeam)}
    if !(1..=120).contains(&rules.minutes){return Err(EngineError::InvalidMinutes(rules.minutes))}
    validate(home)?; validate(away)?;
    let (mut hg,mut ag,mut hx,mut ax)=(0_u8,0_u8,0_u32,0_u32);
    let mut events=Vec::new();
    for minute in 1..=rules.minutes {
        if minute==rules.minutes/2 { events.push(MatchEvent{sequence:events.len() as u16,minute,kind:MatchEventKind::HalfTime,team_id:None}); }
        let hp=probability(home,away,rules.home_advantage_milli);
        let ap=probability(away,home,0); // Convert per-minute probability (millionths) to expected goals (thousandths).
        hx+=hp/1_000; ax+=ap/1_000;
        if hg<12 && roll(seed,match_id,minute,home.id,0)<hp {
            hg+=1; events.push(MatchEvent{sequence:events.len() as u16,minute,kind:MatchEventKind::Goal,team_id:Some(home.id)});
        }
        if ag<12 && roll(seed,match_id,minute,away.id,1)<ap {
            ag+=1; events.push(MatchEvent{sequence:events.len() as u16,minute,kind:MatchEventKind::Goal,team_id:Some(away.id)});
        }
    }
    events.push(MatchEvent{sequence:events.len() as u16,minute:rules.minutes,kind:MatchEventKind::FullTime,team_id:None});
    Ok(MatchResult{engine_version:ENGINE_VERSION,match_id,home_team_id:home.id,away_team_id:away.id,
        home_goals:hg,away_goals:ag,home_xg_milli:hx.min(u16::MAX as u32) as u16,
        away_xg_milli:ax.min(u16::MAX as u32) as u16,events})
}

#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
pub struct PlayedFixture { pub home_team_id:Uuid,pub away_team_id:Uuid,pub home_goals:u8,pub away_goals:u8 }
#[derive(Debug,Clone,Default,PartialEq,Eq,Serialize,Deserialize)]
pub struct TeamStanding { pub team_id:Uuid,pub played:u32,pub wins:u32,pub draws:u32,pub losses:u32,
    pub goals_for:u32,pub goals_against:u32,pub points:u32 }
impl TeamStanding { pub fn goal_difference(&self)->i64{self.goals_for as i64-self.goals_against as i64} }
/// Rebuilds the table exclusively from completed fixture results.
pub fn calculate_standings(fixtures:&[PlayedFixture])->Result<Vec<TeamStanding>,EngineError>{
    if fixtures.iter().any(|f| f.home_team_id == f.away_team_id) { return Err(EngineError::SelfFixture); }
    let mut map:BTreeMap<Uuid,TeamStanding>=BTreeMap::new();
    for f in fixtures {
        let h=map.entry(f.home_team_id).or_insert_with(||TeamStanding{team_id:f.home_team_id,..Default::default()});
        h.played+=1;h.goals_for+=u32::from(f.home_goals);h.goals_against+=u32::from(f.away_goals);
        let a=map.entry(f.away_team_id).or_insert_with(||TeamStanding{team_id:f.away_team_id,..Default::default()});
        a.played+=1;a.goals_for+=u32::from(f.away_goals);a.goals_against+=u32::from(f.home_goals);
        match f.home_goals.cmp(&f.away_goals){
            std::cmp::Ordering::Greater=>{let h=map.get_mut(&f.home_team_id).unwrap();h.wins+=1;h.points+=3;map.get_mut(&f.away_team_id).unwrap().losses+=1;}
            std::cmp::Ordering::Less=>{let a=map.get_mut(&f.away_team_id).unwrap();a.wins+=1;a.points+=3;map.get_mut(&f.home_team_id).unwrap().losses+=1;}
            std::cmp::Ordering::Equal=>{let h=map.get_mut(&f.home_team_id).unwrap();h.draws+=1;h.points+=1;let a=map.get_mut(&f.away_team_id).unwrap();a.draws+=1;a.points+=1;}
        }
    }
    let mut rows:Vec<_>=map.into_values().collect();
    rows.sort_by(|a,b|b.points.cmp(&a.points).then_with(||b.goal_difference().cmp(&a.goal_difference()))
        .then_with(||b.goals_for.cmp(&a.goals_for)).then_with(||a.team_id.cmp(&b.team_id)));Ok(rows)
}

#[cfg(test)]
mod tests{
 use super::*;
 fn team(id:u128)->TeamProfile{TeamProfile{id:Uuid::from_u128(id),attack:70,midfield:65,defence:65,goalkeeper:65,morale:60,fatigue:10}}
 #[test]fn simulation_replays_identically(){let(h,a,id)=(team(1),team(2),Uuid::from_u128(3));assert_eq!(simulate_match(9,id,&h,&a,MatchRules::default()).unwrap(),simulate_match(9,id,&h,&a,MatchRules::default()).unwrap());}
 #[test]fn seed_changes_event_stream(){let(h,a,id)=(team(1),team(2),Uuid::from_u128(3));assert_ne!(simulate_match(9,id,&h,&a,MatchRules::default()).unwrap().events,simulate_match(10,id,&h,&a,MatchRules::default()).unwrap().events);}
 #[test]fn invalid_inputs_are_rejected(){let mut h=team(1);h.attack=101;assert!(matches!(simulate_match(1,Uuid::from_u128(3),&h,&team(2),MatchRules::default()),Err(EngineError::RatingOutOfRange(..))));}
 #[test]fn table_points_and_goal_difference_reconcile(){let(a,b,c)=(Uuid::from_u128(1),Uuid::from_u128(2),Uuid::from_u128(3));let rows=calculate_standings(&[PlayedFixture{home_team_id:a,away_team_id:b,home_goals:2,away_goals:0},PlayedFixture{home_team_id:c,away_team_id:a,home_goals:1,away_goals:1},PlayedFixture{home_team_id:b,away_team_id:c,home_goals:3,away_goals:1}]).unwrap();assert_eq!(rows[0].team_id,a);assert_eq!((rows[0].played,rows[0].points,rows[0].goal_difference()),(2,4,2));assert_eq!(rows.iter().map(|r|r.points).sum::<u32>(),8);}
 #[test]fn standings_reject_self_fixtures(){let a=Uuid::from_u128(1);assert_eq!(calculate_standings(&[PlayedFixture{home_team_id:a,away_team_id:a,home_goals:1,away_goals:0}]),Err(EngineError::SelfFixture));}
 #[test]fn expected_goals_are_in_milli_xg_units(){let(h,a,id)=(team(1),team(2),Uuid::from_u128(3));let r=simulate_match(9,id,&h,&a,MatchRules::default()).unwrap();assert!(r.home_xg_milli<10_000);assert!(r.away_xg_milli<10_000);}
}
