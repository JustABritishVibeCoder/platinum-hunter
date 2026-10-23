# GTA V (PS5) trophy dataset

File: `src/catalog/data/gta-v-ps5.json` (validated by `src/catalog/schema.ts`; tests in `src/catalog/catalog.test.ts`).

## Trophy facts (authoritative fields)

- **Source:** PSNProfiles trophy list for *Grand Theft Auto V* on **PS5** (list 15720), <https://psnprofiles.com/trophies/15720-grand-theft-auto-v>, retrieved **2026-10-21**. This is the PS5 native (2022) list, separate from the PS4 list (PSNProfiles 3147) and the PS3 list (2093).
- **Completeness:** complete. 78 trophies: 1 Platinum, 3 Gold, 15 Silver, 59 Bronze, in four groups:

| Group | Trophies | Required for Platinum |
| --- | --- | --- |
| Base Game (includes the Platinum) | 51 | Yes |
| Grand Theft Auto Online: Heists | 9 | No |
| Rockstar Editor | 10 | No |
| Grand Theft Auto Online: The Doomsday Heist | 8 | No |

- Names, descriptions and grades match the PS5 list exactly.
- **Inferred, not verified:** PSN `trophyId`s (assumed 0-77 in list order) and PSN group IDs (assumed `default`, `001`, `002`, `003`). The first successful PSN sync replaces these with PSN's values, matching trophies by name, and then overwrites names/descriptions/icons/grades with PSN's own data (`facts_source = psn`).
- **Not hard-coded:** the PS5 `npCommunicationId` (not confirmable from a reliable public source). It is resolved from your own PSN trophy list. Candidate PS5 title IDs seen on PlayStation Store/retail listings (`PPSA01721`, `PPSA03420`, `PPSA04263`) are stored for reference only.
- Earn-rate percentages in the dataset are **PSNProfiles** rates among its tracked players (not PSN-wide). After a sync, PSN's own earn rates are shown instead.

## Platinum requirements (base game)

Per the PowerPyx guide (<https://www.powerpyx.com/gta-v-trophy-guide-roadmap/>): 33 single-player and 18 online trophies (including the Platinum); one playthrough is enough; roughly 50-60 h single-player and 100+ h online, overall difficulty 5/10. Key requirements encoded as prerequisites:

- **Story:** 11 story trophies tied to missions, plus the final mission. Choose **Option C (The Third Way)** to keep every character.
- **100% completion** (Career Criminal) and **any 70 of 115 Gold Medals** (Solid Gold, Baby!). Neither needs a single uninterrupted run; missions can be replayed.
- **Collectibles:** 50 spaceship parts, 50 letter scraps, 30 nuclear waste, 50 stunt jumps, 50 Under the Bridge + 15 Knife Flights, map exploration.
- **GTA Online:** Rank 100, 30 Platinum Awards, and several trophies needing 2-4 real players (Numero Uno, The Midnight Club, Backseat Driver, Enjoy Your Stay, Crew Cut, Full Refund). Online play on PS5 needs PlayStation Plus.

## Missable trophies (with basis)

All cited to the PowerPyx roadmap:

| Trophy | Why it can be missed |
| --- | --- |
| Three Man Army | Needs all three characters together off-mission; advised before the last five story missions |
| Wanted: Alive or Alive | Only four bail targets; killing them all locks it; Trevor only |
| Altruist Acolyte | Limited hitchhiker events; delivering them normally locks it; Trevor only |
| Red Mist, TP Industries Arms Race | Trevor only: lost if Trevor is killed (Option A) |
| Kifflom! | Michael only: lost if Michael is killed (Option B); step 7 can glitch |
| To Live or Die in Los Santos | Not missable itself; the ending choice decides the above |

## Guidance and estimates (non-authoritative fields)

- Every trophy has a short **original** summary and steps written for Platinum Hunter, plus links to its PSNProfiles trophy page and the PowerPyx roadmap. No guide text is reproduced.
- **Difficulty (1-10) and time** are **Platinum Hunter editorial estimates** dated 2026-10-21, calibrated against the PowerPyx overview and per-trophy descriptions and sanity-checked against earn rates. Each has a confidence level (most are `low` or `medium`) and is labelled "Estimate" in the UI.
- Story times are computed from your story position at ~25 minutes per mission (69 missions, approximate order from the GTA Wiki mission list). Rank times use PowerPyx's RP thresholds (Rank 25: 127,100; Rank 50: 448,000; Rank 100: 1,583,380) at an assumed ~15,000 RP/hour.
- Guidance for the three add-on groups is brief and low-confidence. Those trophies are not needed for the Platinum and are hidden from recommendations by default.

## Updating the dataset

Edit the JSON and run `npm run validate:catalog`. The schema rejects duplicate IDs, unknown references, non-https links, and a dataset marked `complete` whose grade counts do not match `expectedCounts`. On the next launch the app refreshes guidance without touching your statuses, and never overwrites PSN-verified facts.
