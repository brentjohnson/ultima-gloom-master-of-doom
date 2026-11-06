# Cardbearer — design document

*This document says how the game works. For what it is and why, see [game-pitch.md](game-pitch.md). It changes often, and all numbers are starting values to tune in playtesting.*

**Status labels:** **Built** means it's in the current test fight. **Planned** means it's decided but not built yet.

---

## Scope

- Solo only. There is no co-op or networking.
- The current goal is a vertical slice: one town, one stretch of wilderness and one dungeon.

---

## Character Progression

No classes and no talent trees. Power comes from three places: the deck, level-ups and non-card gear.

**Experience (Planned)**
- Enemies give XP based on how dangerous they are.
- Level thresholds rise, so farming an easy zone slows to a crawl.

**Level-up (Planned).** Each level gives two choices:
1. **Grow one pool:** health, stamina or mana. This is how a character leans toward fighting, spellcasting or a balance.
2. **Upgrade one basic action:** any of them, with no limits for now.

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

**Basic actions.** Always available and free, at initiative 90.

| Action | Effect | Status |
|---|---|---|
| Move | Move 1 | Built, as Struggle: Move |
| Attack | Melee attack for 1 | Built, as Struggle: Attack |
| Catch Breath | Recover stamina and mana | Built, stamina only (+2) |
| Spark (placeholder name) | Weak ranged spell | Planned |

**Attack modifier deck (Built)**
- Contents: six +0, five +1, five -1, one +2, one -2, one x2 and one null.
- Drawing x2 or null reshuffles the deck after that attack.
- The player and enemies have separate decks.
- Spell attacks draw from it too (Planned).

**Conditions (Built)**
- **Bleed:** 1 damage at the start of each turn until healed.
- **Stun:** lose your next turn.
- **Root:** can't move on your next turn.
- **Weak:** -1 damage on your next turn.

**Shields (Built):** block attack damage until the end of the round, but not bleed or trap damage.

**Terrain (Built)**
- **Walls** block movement and sight.
- **Water** blocks movement but not sight.
- **Traps** deal 2 damage once to whoever enters, including pushed enemies.

**Encounters**
- Fleeing from a marked exit ends the fight with no stamina recovery (Built).
- Enemies stand visibly where they were placed, and entering an authored aggro area starts the fight, which is limited to that area (Planned).
- After fleeing, the enemies reset (Planned).

---

## Resources

| Pool | Pays for | Start | Status |
|---|---|---|---|
| Health | Staying alive | 20 | Built |
| Stamina | Physical cards | 20 | Built, without regen |
| Mana | Spell cards | To be tuned | Planned |

**Regen (Planned):** stamina and mana both regenerate slowly, during combat rounds and while walking. This keeps a hand full of spells from being dead for long. Rates will be tuned in playtesting.

**Recovery**
- A rest fully refills all pools (Planned).
- Winning a fight recovers 25% of maximum stamina (Built). See Open Questions.

---

## Cards

**Physical cards (Built):** each has its own printed initiative, stamina cost and effects. The starter deck has 10 cards, and decks hold 10-20.

**Spell cards (Planned)**
- They cost mana instead of stamina.
- They do things physical cards can't: area blasts, long range, blink movement, elemental damage and barriers on the map.

**Rolled properties (Planned)**
- Cards drop with bonus properties, rolled once at drop time, so two copies are rarely identical.
- Examples: +1 range, -1 cost, bleeds on hit. A few may interact with the modifier deck, such as "draw two modifiers and keep the better".
- Properties must be stable effects, not chances, because the modifier deck is the only randomness in combat.
- Rarity tiers set the size and strangeness of the bonus.
- Loot tables belong to zones, and player level is never an input, so better drops come from more dangerous places.

**Non-card gear (Planned, outside the slice):** weapons, armor and trinkets give baseline stats and flavor. The build-defining randomness stays in the cards.

---

## World

- A hand-authored overworld, Ultima III-style, with towns, wilderness and dungeons fixed in place and difficulty.
- Dungeons use the same overhead view, only tighter, darker and denser with traps and puzzles.
- Danger is shown through terrain, monster visuals, NPC warnings and ruined equipment, never a level number over an enemy's head.
- An early "safe ring" surrounds the starting town, and regions get rougher farther out or off the beaten path.
- Resting resets zones: enemies return to their hand-placed spots, so drops can be farmed while danger stays fixed. Unique bosses and treasure stay claimed.

---

## Stakes & Modes

- **Standard mode:** on death, lose 25% of carried gold and return to the last rest. The character and deck persist.
- **Hardcore mode:** permadeath. The save is deleted on death.

---

## Open Questions

**To settle in playtesting**
- **Diagonal adjacency:** the current rule is orthogonal-only, but the expectation from Ultima and Tunnels of Doom is that diagonals are adjacent. Switching would need a rebalance, since all-adjacent attacks could reach 8 enemies.
- **Hidden enemy plans:** does committing blind feel fair?
- **Modifier swing:** do x2 and null add tension, or undo good positioning?
- **Regen rates and pool sizes**, including starting mana and how much a level adds to a pool.
- **Post-fight recovery:** does the 25% stamina recovery still earn its place now that walking regens stamina? If it stays, should it cover mana too?

**To design later**
- What each basic action upgrade actually improves. For example, does Move gain range, or Spark gain damage or range?
- How much XP enemies give, and the level thresholds.
- Whether a level cap is needed. With no upgrade limits, late levels could flatten fixed zones.
- How many card schools exist (elemental, martial, utility) and how they interact.
- Whether non-card gear rolls its own properties or stays simple.
- Overworld scope: single continent or multiple regions.
- Art direction: literal retro pixel art or a modern-clean take. The current sprites are placeholders.
