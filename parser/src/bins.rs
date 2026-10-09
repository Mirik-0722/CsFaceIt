//! Heat bins: how often a player was in each square of the map, counted separately for the positions kills were made
//! from, the positions deaths happened at, and the sampled positions of movement.

use std::collections::BTreeMap;

use crate::parse::{Facts, Side};

/// The side of a bin in world units.
pub const BIN_SIZE: f32 = 64.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Kind {
    /// Where the killer stood, for every kill that has a killer.
    Kill,
    /// Where the victim stood, for every kill.
    Death,
    /// Where a living player stood at a sampled tick.
    Movement,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Kill => "kill",
            Kind::Death => "death",
            Kind::Movement => "movement",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct HeatBin {
    pub steam_id: u64,
    pub kind: Kind,
    pub side: Side,
    pub bin_x: i32,
    pub bin_y: i32,
    pub count: i32,
}

/// The index of the bin a coordinate falls into; negative coordinates get negative indexes.
fn bin(coordinate: f32) -> i32 {
    (coordinate / BIN_SIZE).floor() as i32
}

/// Counts the positions of `facts` per player, kind, side and bin. A kill or death without a known position or side
/// is not counted. The result is in a fixed order.
pub fn aggregate(facts: &Facts) -> Vec<HeatBin> {
    let mut counts: BTreeMap<(u64, Kind, Side, i32, i32), i32> = BTreeMap::new();
    let mut count = |steam_id: u64, kind: Kind, side: Side, x: f32, y: f32| {
        *counts
            .entry((steam_id, kind, side, bin(x), bin(y)))
            .or_insert(0) += 1;
    };

    for kill in &facts.kills {
        if let (Some(killer), Some(side), Some(x), Some(y)) = (
            kill.killer_steam_id,
            kill.killer_side,
            kill.killer_x,
            kill.killer_y,
        ) {
            count(killer, Kind::Kill, side, x, y);
        }
        if let (Some(side), Some(x), Some(y)) = (kill.victim_side, kill.victim_x, kill.victim_y) {
            count(kill.victim_steam_id, Kind::Death, side, x, y);
        }
    }
    for position in &facts.positions {
        count(
            position.steam_id,
            Kind::Movement,
            position.side,
            position.x,
            position.y,
        );
    }

    counts
        .into_iter()
        .map(|((steam_id, kind, side, bin_x, bin_y), count)| HeatBin {
            steam_id,
            kind,
            side,
            bin_x,
            bin_y,
            count,
        })
        .collect()
}
