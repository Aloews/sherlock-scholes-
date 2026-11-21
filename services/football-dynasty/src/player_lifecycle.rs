//! Deterministic player career, training, recovery and valuation rules.
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::squad::PlayerAttributes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrainingFocus { Finishing, Passing, Defending, Physical, Goalkeeping, Balanced }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainingPlan {
    pub focus: TrainingFocus,
    pub intensity: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCareer {
    pub id: Uuid,
    pub age: u8,
    pub potential: u8,
    pub attributes: PlayerAttributes,
    pub morale: u8,
    pub fatigue: u8,
    pub appearances: u32,
    pub goals: u32,
    pub assists: u32,
    pub minutes_played: u32,
    pub injury_until: Option<NaiveDate>,
    pub suspension_matches: u8,
    pub contract_until: NaiveDate,
    pub wage_minor: u64,
    pub market_value_minor: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainingOutcome {
    pub improved: Option<TrainingFocus>,
    pub attribute_gain: u8,
    pub fatigue_added: u8,
    pub morale_change: i8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CareerError {
    InvalidAge(u8),
    InvalidRating,
    InvalidIntensity(u8),
    InvalidMatchLoad,
}
impl std::fmt::Display for CareerError {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {
        match self {
            Self::InvalidAge(v)=>write!(f,"invalid player age: {v}"),
            Self::InvalidRating=>write!(f,"player rating, morale, fatigue and potential must be 0..=100"),
            Self::InvalidIntensity(v)=>write!(f,"training intensity must be 0..=100, got {v}"),
            Self::InvalidMatchLoad=>write!(f,"invalid match load"),
        }
    }
}
impl std::error::Error for CareerError {}

fn validate(player:&PlayerCareer)->Result<(),CareerError>{
    if !(15..=45).contains(&player.age){return Err(CareerError::InvalidAge(player.age));}
    let a=player.attributes;
    if [a.pace,a.shooting,a.passing,a.defending,a.physical,a.goalkeeping,a.stamina,
        player.potential,player.morale,player.fatigue].iter().any(|v|*v>100){
        return Err(CareerError::InvalidRating);
    }
    Ok(())
}

fn focus_value(player:&PlayerCareer,focus:TrainingFocus)->u8{
    let a=player.attributes;
    match focus {
        TrainingFocus::Finishing=>a.shooting,
        TrainingFocus::Passing=>a.passing,
        TrainingFocus::Defending=>a.defending,
        TrainingFocus::Physical=>a.physical,
        TrainingFocus::Goalkeeping=>a.goalkeeping,
        TrainingFocus::Balanced=>[a.pace,a.shooting,a.passing,a.defending,a.physical,a.goalkeeping,a.stamina]
            .into_iter().min().unwrap_or(0),
    }
}

fn set_focus_value(player:&mut PlayerCareer,focus:TrainingFocus,value:u8){
    match focus {
        TrainingFocus::Finishing=>player.attributes.shooting=value,
        TrainingFocus::Passing=>player.attributes.passing=value,
        TrainingFocus::Defending=>player.attributes.defending=value,
        TrainingFocus::Physical=>player.attributes.physical=value,
        TrainingFocus::Goalkeeping=>player.attributes.goalkeeping=value,
        TrainingFocus::Balanced=>{
            let mut values=[player.attributes.pace,player.attributes.shooting,player.attributes.passing,
                player.attributes.defending,player.attributes.physical,player.attributes.goalkeeping,
                player.attributes.stamina];
            let index=values.iter().enumerate().min_by_key(|(_,v)|**v).map(|(i,_)|i).unwrap_or(0);
            values[index]=value;
            player.attributes.pace=values[0];player.attributes.shooting=values[1];
            player.attributes.passing=values[2];player.attributes.defending=values[3];
            player.attributes.physical=values[4];player.attributes.goalkeeping=values[5];
            player.attributes.stamina=values[6];
        }
    }
}

/// Applies one deterministic training session. Improvement is capped by potential;
/// intensity trades faster training for fatigue and morale risk.
pub fn apply_training(
    player:&mut PlayerCareer,
    plan:TrainingPlan,
    seed:u64,
)->Result<TrainingOutcome,CareerError>{
    validate(player)?;
    if plan.intensity>100{return Err(CareerError::InvalidIntensity(plan.intensity));}
    if player.injury_until.is_some(){return Ok(TrainingOutcome{improved:None,attribute_gain:0,fatigue_added:0,morale_change:0});}
    let current=focus_value(player,plan.focus);
    let age_factor=if player.age<=21 {3_u8} else if player.age<=27 {2} else {1};
    let intensity_factor=plan.intensity/35;
    let potential_gap=player.potential.saturating_sub(current);
    let noise=((seed ^ player.id.as_u128() as u64)%2) as u8;
    let gain=if plan.intensity<20 || potential_gap==0 {0}
        else {(age_factor+intensity_factor+noise).min(3).min(potential_gap)};
    if gain>0 {set_focus_value(player,plan.focus,current.saturating_add(gain));}
    let fatigue_added=plan.intensity/20;
    player.fatigue=player.fatigue.saturating_add(fatigue_added).min(100);
    let morale_change=if gain>0 {1} else if plan.intensity>=80 {-2} else {0};
    player.morale=(i16::from(player.morale)+i16::from(morale_change)).clamp(0,100) as u8;
    Ok(TrainingOutcome{improved:if gain>0{Some(plan.focus)}else{None},attribute_gain:gain,fatigue_added,morale_change})
}

/// Daily recovery is explicit and never advances a player's age or game clock.
pub fn recover(player:&mut PlayerCareer,days:u16){
    let recovery=u32::from(days).saturating_mul(8).min(100) as u8;
    player.fatigue=player.fatigue.saturating_sub(recovery);
}

/// Applies the persisted statistical load from one completed appearance.
pub fn record_match(
    player:&mut PlayerCareer,
    minutes:u8,
    goals:u8,
    assists:u8,
    injury_until:Option<NaiveDate>,
    suspension_matches:u8,
)->Result<(),CareerError>{
    validate(player)?;
    if minutes>130 || goals>20 || assists>20 || assists>goals {
        return Err(CareerError::InvalidMatchLoad);
    }
    if minutes>0 {
        player.appearances=player.appearances.saturating_add(1);
        player.minutes_played=player.minutes_played.saturating_add(u32::from(minutes));
        player.goals=player.goals.saturating_add(u32::from(goals));
        player.assists=player.assists.saturating_add(u32::from(assists));
        player.fatigue=player.fatigue.saturating_add((minutes/10).max(1)).min(100);
    }
    if let Some(until)=injury_until {
        player.injury_until=Some(player.injury_until.map_or(until,|old|old.max(until)));
    }
    player.suspension_matches=player.suspension_matches.saturating_add(suspension_matches);
    Ok(())
}


/// Match availability is derived from persisted injury dates and match suspensions.
pub fn available_for_match(player:&PlayerCareer,match_date:NaiveDate)->bool{
    player.injury_until.is_none_or(|until|until<match_date) && player.suspension_matches==0
}

/// Clears an injury marker once the campaign date has passed its recovery date.
pub fn clear_expired_injury(player:&mut PlayerCareer,today:NaiveDate){
    if player.injury_until.is_some_and(|until|until<today){player.injury_until=None;}
}

/// A player's suspension is served when their club completes a match, even if they
/// were not selected in the matchday squad. Call once per completed club fixture.
pub fn consume_team_match_suspensions(players:&mut [PlayerCareer]){
    for player in players {
        player.suspension_matches=player.suspension_matches.saturating_sub(1);
    }
}

pub fn contract_expired(player:&PlayerCareer,today:NaiveDate)->bool{
    today>player.contract_until
}

/// A transparent heuristic, not an external market quote. Currency is minor units.
pub fn estimate_market_value_minor(player:&PlayerCareer,today:NaiveDate)->u64{
    let a=player.attributes;
    let overall=(u32::from(a.pace)+u32::from(a.shooting)+u32::from(a.passing)
        +u32::from(a.defending)+u32::from(a.physical)+u32::from(a.stamina))/6;
    let age_factor=match player.age {
        15..=20=>150_u64,21..=24=>130,25..=28=>100,29..=31=>70,_=>35
    };
    let potential_factor=100_u64+u64::from(u32::from(player.potential).saturating_sub(overall))*2;
    let days=(player.contract_until-today).num_days().max(0) as u64;
    let contract_factor=50+days.min(1_095)*50/1_095;
    u64::from(overall).saturating_mul(u64::from(overall))
        .saturating_mul(age_factor).saturating_mul(potential_factor)
        .saturating_mul(contract_factor).saturating_mul(100)
        / 1_000_000
}

#[cfg(test)]
mod tests{
    use super::*;
    fn player()->PlayerCareer{
        PlayerCareer{id:Uuid::from_u128(7),age:19,potential:90,
            attributes:PlayerAttributes{pace:60,shooting:55,passing:60,defending:50,physical:65,goalkeeping:10,stamina:70},
            morale:60,fatigue:20,appearances:0,goals:0,assists:0,minutes_played:0,
            injury_until:None,suspension_matches:0,contract_until:NaiveDate::from_ymd_opt(2029,6,30).unwrap(),
            wage_minor:10_000,market_value_minor:1_000_000}
    }
    #[test]fn training_respects_potential_and_is_reproducible(){
        let mut a=player();let mut b=player();let plan=TrainingPlan{focus:TrainingFocus::Finishing,intensity:80};
        assert_eq!(apply_training(&mut a,plan,42).unwrap(),apply_training(&mut b,plan,42).unwrap());
        assert_eq!(a.attributes.shooting,b.attributes.shooting);
        assert!(a.attributes.shooting<=a.potential);
    }
    #[test]fn injured_player_cannot_gain_training(){
        let mut p=player();p.injury_until=Some(NaiveDate::from_ymd_opt(2026,1,10).unwrap());
        let before=p.attributes;
        let out=apply_training(&mut p,TrainingPlan{focus:TrainingFocus::Finishing,intensity:100},1).unwrap();
        assert_eq!(out.attribute_gain,0);assert_eq!(p.attributes,before);
    }
    #[test]fn recovery_is_bounded(){
        let mut p=player();recover(&mut p,3);assert_eq!(p.fatigue,0);
    }
    #[test]fn match_stats_and_suspensions_accumulate(){
        let mut p=player();record_match(&mut p,90,2,1,None,1).unwrap();
        assert_eq!((p.appearances,p.goals,p.assists,p.suspension_matches),(1,2,1,1));
    }
    #[test]fn contract_expiry_uses_game_date(){
        let p=player();assert!(!contract_expired(&p,NaiveDate::from_ymd_opt(2029,6,30).unwrap()));
        assert!(contract_expired(&p,NaiveDate::from_ymd_opt(2029,7,1).unwrap()));
    } 
    #[test]fn match_availability_respects_injury_date_and_suspensions(){
        let date=NaiveDate::from_ymd_opt(2026,5,10).unwrap();
        let mut p=player();
        assert!(available_for_match(&p,date));
        p.injury_until=Some(date);
        assert!(!available_for_match(&p,date));
        clear_expired_injury(&mut p,date);
        assert_eq!(p.injury_until,Some(date));
        clear_expired_injury(&mut p,date+chrono::Duration::days(1));
        assert!(available_for_match(&p,date+chrono::Duration::days(1)));
        p.suspension_matches=2;
        assert!(!available_for_match(&p,date+chrono::Duration::days(1)));
    }
    #[test]fn suspension_is_consumed_once_per_completed_team_match(){
        let mut players=vec![player(),player()];players[1].id=Uuid::from_u128(8);
        players[0].suspension_matches=1;players[1].suspension_matches=3;
        consume_team_match_suspensions(&mut players);
        assert_eq!((players[0].suspension_matches,players[1].suspension_matches),(0,2));
        consume_team_match_suspensions(&mut players);
        assert_eq!((players[0].suspension_matches,players[1].suspension_matches),(0,1));
    }

}
