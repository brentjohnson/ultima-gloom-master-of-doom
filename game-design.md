# Cardbearer — design document

*This document says how the game works. For what it is and why, see [game-pitch.md](game-pitch.md). It changes often, and all numbers are starting values to tune in playtesting.*

**Status labels:** **Built** means it's in the game now. **Planned** means it's decided but not built yet.

---

## Scope

- Solo only. There is no co-op or networking.
- The current goal is a vertical slice: one town, one stretch of wilderness and one dungeon.

---

## Character Progression

No classes and no talent trees. Power comes from three places: the deck, level-ups and non-card gear.

**Experience (Built)**
- Each enemy type has its own XP value, set by how dangerous it is: Mire Skulker 4, Hollow Archer 5. Player level never changes it.
- XP is paid when you win, for every enemy killed. Fleeing pays nothing, even after a kill, because the enemies all return.
- Total XP needed for levels 2-9: 8, 20, 40, 70, 110, 160, 220, 300. The gaps keep growing, so farming an easy zone slows to a crawl. Level 9 is the cap for now.

**Level-up (Built).** Each level gives two choices, made on a level-up screen before you can walk on:
1. **Grow one pool:** health +4, stamina +4 or mana +3. The current value grows with the maximum. This is how a character leans toward fighting, spellcasting or a balance.
2. **Upgrade one basic action:** +1 to any one of its numbers, or 10 faster initiative (never below 1). For example: Move range, Attack damage or range, Spark damage or range, Catch Breath stamina or mana. There are no other limits for now.

Basic action upgrades do not affect cards. A card always does what it says.

**Fallback rule, if balance needs it:** a basic action can't be upgraded more than two levels above your lowest one.

---

## Combat

Fights happen in place on the world map. One tile is one combat square on a square grid.

**Round (Built)**
1. Choose one card from a hand of 5, or use a basic action. Enemy plans stay hidden until you commit.
2. Enemies reveal their behavior cards, and everyone acts in initiative order, lowest first. The player wins ties.
3. The played card is discarded and the hand refills. The discard pile reshuffles into the deck when the deck runs out.

Effects on a card are optional and resolve in the order printed.

**Adjacency, movement and range (Built):** only the four orthogonal directions count. A diagonal square is at range 2, and all-adjacent attacks hit at most four enemies. See Open Questions.

**Basic actions.** Always available and free, at initiative 90 until upgraded.

| Action | Effect | Status |
|---|---|---|
| Move | Move 1 | Built |
| Attack | Melee attack for 2 | Built |
| Spark (placeholder name) | Ranged attack for 1, range 3 | Built |
| Catch Breath | +2 stamina, +2 mana | Built |

Attack does more than Spark so that closing to melee is still worth it.

**Attack modifier deck (Built)**
- Contents: six +0, five +1, five -1, one +2, one -2, one x2 and one null.
- Drawing x2 or null reshuffles the deck after that attack.
- The player and enemies have separate decks.
- Spell attacks draw from it too.

**Conditions (Built)**
- **Bleed:** 1 damage at the start of each turn until healed.
- **Stun:** lose your next turn.
- **Root:** can't move on your next turn.
- **Weak:** -1 damage on your next turn.

**Shields (Built):** block attack damage until the end of the round, but not bleed or trap damage.

**Terrain (Built)**
- **Walls and trees** block movement and sight.
- **Water** blocks movement but not sight.
- **Floor and grass** block nothing.
- **Doors** block sight until someone walks through, then stay open.
- **Traps** deal 2 damage once to whoever enters, including pushed enemies and a player who is just walking.

Sprung traps and opened doors stay that way after a fight.

**Encounters**
All of this is built.
- Enemies stand visibly where they were placed. Entering an encounter's area starts the fight in place, and it can't leave that area.
- Exit tiles inside the area never start the fight, so you can approach along them and retreat to them.
- Fleeing from an exit ends the fight with no stamina recovery. The enemies go back to their places, and you keep any damage.
- Beating an encounter clears it, for now permanently. Zone resets arrive with rests.
- A fight's area must fit on one screen (14x10 tiles).

---

## Resources

| Pool | Pays for | Start | Status |
|---|---|---|---|
| Health | Staying alive | 20 | Built |
| Stamina | Physical cards | 20 | Built |
| Mana | Spell cards | 10 | Built |

**Regen:** stamina and mana both regenerate slowly, which keeps a hand full of spells from being dead for long.
- During combat, each pool gains 1 per round, starting with round 2 (Built).
- While walking, each pool gains 1 every 4 steps (Built). Health doesn't regenerate.
- Rates will be tuned in playtesting.

**Recovery**
- A rest fully refills all pools (Planned).
- Winning a fight recovers 25% of maximum stamina (Built). See Open Questions.

---

## Cards

**Physical cards (Built):** each has its own printed initiative, stamina cost and effects.

**Decks (Built)**
- A deck holds 10-20 cards. Every card you own is in your collection, and the deck is whichever of them you've chosen.
- You can change the deck at any time outside a fight (press C).
- You start with 14 plain cards, which have no rolled properties. Found cards go to the collection, not straight into the deck.

**Spell cards**
- They cost mana instead of stamina (Built).
- They do things physical cards can't. Built: area blasts, long range and blink movement. Planned: elemental damage and barriers on the map.
- **Blast:** also hits enemies near the target, if the target has line of sight to them.
- **Blink:** teleports to a tile within range and in sight. It crosses water and figures, works while rooted, and still springs a trap you land on.
- The starting deck has 4 spells: Slipstep, Daze, Frost Lance and Firebloom.

**Rolled properties (Built)**
- Cards drop with bonus properties (affixes), rolled once at drop time, so two copies are rarely identical.
- Properties are stable effects, not chances, because the modifier deck is the only randomness in combat.
- A card can hold only one affix from each group, and only gets affixes that would change it.

| Rarity | Affixes | Examples of what it can roll |
|---|---|---|
| Common | 1 | Keen (+1 damage), Swift (-10 initiative), Thrifty (-1 cost), Far-Reaching (+1 range) |
| Rare | 2 | Also Brutal (+2 damage), Barbed (bleeds on hit), Binding (roots on hit) |
| Fabled | 3 | Also Stunning (stuns on hit), Fated (draw two modifiers, keep the better), Warding (also shield 2) |

**Drops (Built)**
- Winning a fight drops cards, shown on the victory screen. Fleeing drops nothing.
- Each encounter names a zone, and each zone has its own loot table: how many cards it drops, the odds of each rarity and which cards it can give.
- Player level is never an input, so better drops come from more dangerous places.
- The Wilds drop 1 card with no Fabled chance. The Crypt drops 2 with far better odds, and it's the only place to find the 5 cards outside the starting deck.
- Treasure chests are not built yet.

**Non-card gear (Planned, outside the slice):** weapons, armor and trinkets give baseline stats and flavor. The build-defining randomness stays in the cards.

---

## World

- A hand-authored overworld, Ultima III-style, with towns, wilderness and dungeons fixed in place and difficulty.
- Dungeons use the same overhead view, only tighter, darker and denser with traps and puzzles.
- In a dark level you can see 5 tiles, and walls block your view. Enemies you can't see aren't shown. Fights light up their whole area (Built).
- You walk one tile at a time in the four orthogonal directions (Built).
- Danger is shown through terrain, monster visuals, NPC warnings and ruined equipment, never a level number over an enemy's head.
- An early "safe ring" surrounds the starting town, and regions get rougher farther out or off the beaten path.
- Resting resets zones: enemies return to their hand-placed spots, so drops can be farmed while danger stays fixed. Unique bosses and treasure stay claimed.

---

## Stakes & Modes

- **Standard mode:** on death, lose 25% of carried gold and return to the last rest. The character and deck persist. (Planned. For now, death means starting a new game.)
- **Hardcore mode:** permadeath. The save is deleted on death.

---

## Open Questions

**To settle in playtesting**
- **Hidden enemy plans and modifier swing:** the first combat playtest was fine with both, but revisit them once real encounters exist.
- **XP values, level thresholds and pool growth.** The test map holds 17 XP in all, so it gives exactly one level.
- **Upgrade balance:** Attack range +1 lets melee Attack hit from 2 squares away. Is that fine, or should some numbers be off limits?
- **Regen rates and pool sizes.** With regen, stamina may be too plentiful within a single fight.
- **Loot pace and power:** are drops frequent and strong enough to feel exciting, without Fabled cards flattening fixed zones? Should a found card offer to join the deck right away?
- **Post-fight recovery:** does the 25% stamina recovery still earn its place now that walking regens stamina? If it stays, should it cover mana too?

**To design later**
- Whether level 9 is the right cap. With no upgrade limits, late levels could flatten fixed zones.
- How many card schools exist (elemental, martial, utility) and how they interact.
- Whether non-card gear rolls its own properties or stays simple.
- Overworld scope: single continent or multiple regions.
- Art direction: literal retro pixel art or a modern-clean take. The current sprites are placeholders.
