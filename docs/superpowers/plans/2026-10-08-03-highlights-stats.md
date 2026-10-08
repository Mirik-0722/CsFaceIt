# 3-quyi loyiha: Highlight Detection va Statistika — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Darajasi:** spec detektor qoidalari va formulalarni aniq beradi (7, 8-bo'limlar); jadval/API shakli bu rejaning qarori. Reja 2-quyi loyiha `PARSED` holatini ishlab chiqarganda bajariladi.

**Goal:** `demo.parsed` xabari kelganda backend xom faktlardan (rounds, kills, damages) highlight'larni (ACE, K4, K3, CLUTCH_1V1..1V5, NO_SCOPE, KNIFE_KILL, WALLBANG, SMOKE_KILL, NINJA_DEFUSE) aniqlab `highlights` ga yozadi, o'yinchi-match statistikasini (K/D, HS%, ADR, KAST, Entry, Trade, Clutch %) hisoblab `player_match_stats` ga yozadi, `demos.status=ANALYZED` qiladi va UI'da ko'rsatadi.

**Architecture:** `analysis/` paketi: `MatchFacts` (bir match uchun xotiraga yuklangan rounds/kills/damages) → `HighlightDetector` interfeysi (`List<Highlight> detect(MatchFacts)`) ning har tur uchun bitta implementatsiyasi → `HighlightService` barcha detektorlarni ishlatib, K3/K4/ACE ustunligini qo'llab yozadi. `StatsCalculator` sof funksiya: `MatchFacts` → `Map<playerId, PlayerMatchStatsValues>`. `AnalysisOrchestrator` `demo.parsed` listener'idan chaqiriladi, idempotent (match bo'yicha eski highlight'larni o'chirib yozadi). Chegaralar `analysis.*` konfiguratsiyasida.

**Tech Stack:** Spring Boot (1-reja asosida), Spring AMQP (2-reja), Flyway `V3__analysis.sql`; frontend: React + Recharts (statistika kartalari), mavjud `api/` qatlami.

**Spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (7, 8, 11, 14, 16.5, 17-bo'limlar)

## Global Constraints

- Detektor qoidalari spec 7-jadvalga aynan mos; **yuqori tur bo'lsa pastkisi yozilmaydi** (ACE bo'lsa K4/K3 yo'q; K4 bo'lsa K3 yo'q).
- Clutch faqat round yutilganda `highlights` ga yoziladi; yutqazilgani statistikada urinish sifatida hisoblanadi.
- Snayperlar aynan: AWP, SSG 08, G3SG1, SCAR-20 (demo weapon nomlari: `awp`, `ssg08`, `g3sg1`, `scar20`).
- `tick_start = event_tick - 3 s × tick_rate`, `tick_end = last_event_tick + 2 s × tick_rate`; 3 s va 2 s `analysis.clip.pre-seconds`/`post-seconds` konfiguratsiyada; round chegaralari bilan kesiladi (`max(round.start_tick, ...)`, `min(round.end_tick, ...)`).
- NINJA_DEFUSE chegaralari (`analysis.ninja.radius-units`, default 600) konfiguratsiyada.
- Formulalar spec 8-jadvalga aynan: `K/D = kills / max(deaths,1)`, `HS% = headshots / kills` (kills=0 → 0), `ADR = Σ_round min(100, Σ_victim damage) / rounds`, `KAST = (K ∨ A ∨ S ∨ T bo'lgan roundlar) / rounds`, Entry = jamoaning roundagi birinchi kill'i, Trade = jamoadosh o'limidan 5 s ichida qotilini o'ldirish (`analysis.trade-window-seconds=5`), `Clutch% = yutilgan / urinishlar`, `Win Rate = yutilgan matchlar / matchlar`.
- Har detektor uchun kamida bitta ijobiy va bitta chegaraviy test (spec 14).
- `highlights` jadvali render uchun tayyor qoladi (`tick_start`/`tick_end` aynan tick); `score` ustuni 6-bosqichda.

## Review Focus

1. **Overtime roundlar** (round_number > 24): statistika va detektorlar barcha roundlarni hisoblaydi, 24 da to'xtamaydi (Task 1, `factsIncludeOvertimeRounds`).
2. **Team kill / o'z-o'zini o'ldirish**: ACE/K-count'ga qo'shilmaydi, deaths'ga qo'shiladi (Task 2, `teamKillDoesNotCountTowardsMultiKill`).
3. **O'yinchi roundni tirik tugatmagan clutch** (1v1 da bomba portlab round yutilsa): `winner_side` bo'yicha yutuq hisoblanadi, tiriklik emas (Task 3, `clutchWonByBombCountsAsWin`).
4. **Qayta tahlil**: `highlights` dublikatsiz, `player_match_stats` qatorlari yangilanadi (Task 6, `reanalysisReplacesHighlightsAndUpdatesStats`).
5. **Round'siz/kill'siz match** (parser 0 round qaytargan): ANALYZED bo'ladi, bo'linish-nolga yo'q (Task 4, `emptyMatchProducesZeroStatsWithoutError`).

---

## Fayl tuzilmasi

```
backend/src/main/java/io/csfaceit/backend/analysis/
├── AnalysisProperties.java          # clip.pre/post, ninja.radius, trade-window
├── facts/MatchFacts.java, FactsLoader.java, RoundFacts.java, KillFact.java, DamageFact.java
├── highlight/HighlightDetector.java, HighlightType.java, HighlightCandidate.java
├── highlight/MultiKillDetector.java         # ACE, K4, K3 (bitta sinf, ustunlik ichida)
├── highlight/ClutchDetector.java
├── highlight/SpecialKillDetector.java       # NO_SCOPE, KNIFE_KILL, WALLBANG, SMOKE_KILL
├── highlight/NinjaDefuseDetector.java
├── highlight/HighlightService.java, HighlightRepository.java (Highlight entity -> highlight/)
├── stats/StatsCalculator.java, PlayerMatchStatsValues.java, StatsService.java
├── AnalysisOrchestrator.java
└── api/HighlightController.java, StatsController.java, dto/*
resources/db/migration/V3__analysis.sql
frontend/src/pages/HighlightsPage.tsx, components/HighlightList.tsx, components/StatsCards.tsx
```

---

### Task 1: `V3__analysis.sql` va `MatchFacts` yuklovchi

**Files:** `V3__analysis.sql`; `analysis/facts/*`; test `FactsLoaderTest.java`

**Interfaces:**
- `V3`: `ALTER TABLE player_match_stats ADD COLUMN entry_kills INT DEFAULT 0, trade_kills INT DEFAULT 0, clutch_attempts INT DEFAULT 0, clutch_wins INT DEFAULT 0, rounds_played INT DEFAULT 0`; `ALTER TABLE rounds ADD COLUMN bomb_planted_tick INT, bomb_defused_tick INT, defuser_id BIGINT` (parser 2-reja T5 da shu maydonlarni to'ldirish uchun yangilanadi — bog'liqlik 2-rejaga qaytariladi); `ALTER TABLE kills ADD COLUMN killer_side VARCHAR(2), victim_side VARCHAR(2), assister_id BIGINT`.
- `record MatchFacts(long matchId, int tickRate, List<RoundFacts> rounds, Map<Long, String> playerFaceitIds)`; `record RoundFacts(int roundNumber, String winnerSide, int startTick, int endTick, Integer bombPlantedTick, Integer bombDefusedTick, Long defuserId, List<KillFact> kills, List<DamageFact> damages, Map<Long, String> sides)`; `record KillFact(int tick, long killerId, long victimId, String weapon, boolean headshot, boolean wallbang, boolean noscope, boolean thrusmoke, boolean attackerBlind, String killerSide, String victimSide, Long assisterId)`; `record DamageFact(int tick, long attackerId, long victimId, int damageHealth)`.
- `FactsLoader.load(long matchId) -> MatchFacts` — rounds/kills/damages ni 3 so'rov bilan yuklab round bo'yicha guruhlaydi; kill'lar tick bo'yicha saralangan.
- Test yordamchisi `FactsBuilder` (`src/test/.../analysis/FactsBuilder.java`): `round(n).win("CT").kill(tick, killer, victim, weapon, opts...)` — sintetik faktlar; barcha detektor/statistika testlari shu bilan yoziladi.

- [ ] Step 1: Testlar `loadsRoundsWithKillsSortedByTick`, `factsIncludeOvertimeRounds` (30 round → 30). Step 2: FAIL. Step 3: SQL + yuklovchi + builder. Step 4: PASS. Step 5: Commit `feat(analysis): add V3 schema and MatchFacts loader`.

---

### Task 2: `MultiKillDetector` (ACE / K4 / K3) va `SpecialKillDetector`

**Interfaces:**
- `interface HighlightDetector { List<HighlightCandidate> detect(MatchFacts facts); }`; `record HighlightCandidate(HighlightType type, long playerId, int roundNumber, int firstTick, int lastTick)`; `enum HighlightType { ACE, K4, K3, CLUTCH_1V1, CLUTCH_1V2, CLUTCH_1V3, CLUTCH_1V4, CLUTCH_1V5, NO_SCOPE, KNIFE_KILL, WALLBANG, SMOKE_KILL, NINJA_DEFUSE }`.
- `MultiKillDetector`: roundda o'yinchi raqib kill'lari (`killerSide != victimSide`, `killerId != victimId`) soni 5 → ACE, 4 → K4, 3 → K3; faqat bittasi. `firstTick` = birinchi kill, `lastTick` = oxirgi kill.
- `SpecialKillDetector`: har kill uchun — pichoq (`weapon` `knife` bilan boshlanadi) → KNIFE_KILL; `noscope && weapon ∈ {awp, ssg08, g3sg1, scar20}` → NO_SCOPE; `wallbang` → WALLBANG; `thrusmoke` → SMOKE_KILL. Bir kill bir nechta turga tushishi mumkin. `firstTick = lastTick = tick`.

- [ ] Step 1: Testlar — `fiveEnemyKillsIsAceOnly`, `fourKillsIsK4NotK3`, `threeKillsIsK3`, `twoKillsIsNothing`, `teamKillDoesNotCountTowardsMultiKill` (4 raqib + 1 jamoadosh → K4), `noscopeWithAkIsNotNoScope`, `noscopeWithAwpIsNoScope`, `knifeKillDetected`, `wallbangAndSmokeOnSameKillYieldTwo`.
- [ ] Step 2–5: TDD; Commit `feat(analysis): add multi-kill and special-kill highlight detectors`.

---

### Task 3: `ClutchDetector` va `NinjaDefuseDetector`

**Interfaces:**
- `ClutchDetector`: round ichida tick bo'yicha tiriklar hisoblanadi (round boshida har tomonda 5 yoki `sides` dagi o'yinchilar soni). O'yinchi jamoasida yagona tirik qolgan paytda raqibda `N ≥ 1` tirik → urinish `CLUTCH_1VN` (N = o'sha paytdagi raqib tiriklar soni). Round `winnerSide == o'yinchi tomoni` → highlight (`firstTick` = yolg'iz qolgan tick, `lastTick` = round `endTick`); aks holda highlight yo'q. Ikkala natija `ClutchDetector.attempts(MatchFacts) -> List<ClutchAttempt(playerId, roundNumber, n, won)>` orqali statistikaga beriladi.
- `NinjaDefuseDetector`: `bombDefusedTick != null && defuserId != null`; defuse tugaganda raqib (T) tiriklar ≥ 1; defuse boshlanish tick'i (`bombDefusedTick - defuseDurationTicks`, kit bor deb 5 s) da hech bir tirik T defuser'dan `ninja.radiusUnits` ichida bo'lmasligi kerak — pozitsiya `heat_bins`/positions dan yaqinlashtiriladi (2-reja parseri `positions` ni DB ga yozmagani uchun bu bosqichda pozitsiya tekshiruvi `kills` dagi oxirgi ma'lum `victim/killer_x,y` bilan evristik). Chegara va evristika `AnalysisProperties.Ninja` da.

- [ ] Step 1: Testlar — `oneVsThreeWonIsClutch1v3`, `oneVsOneLostIsAttemptNotHighlight`, `clutchWonByBombCountsAsWin`, `neverAloneIsNoAttempt`, `ninjaDefuseWithEnemyAliveAndFar`, `defuseWithNoEnemiesAliveIsNotNinja`.
- [ ] Step 2–5: TDD; Commit `feat(analysis): add clutch and ninja defuse detectors`.

---

### Task 4: `StatsCalculator`

**Interfaces:**
- `record PlayerMatchStatsValues(int kills, int deaths, int assists, int headshots, double adr, double kast, int entryKills, int tradeKills, int clutchAttempts, int clutchWins, int roundsPlayed)`; yordamchilar `kd()`, `hsPercent()`, `clutchPercent()`.
- `StatsCalculator.calculate(MatchFacts facts, List<ClutchAttempt> clutches) -> Map<Long, PlayerMatchStatsValues>` — sof, DB'siz. Trade: jamoadosh `victim` bo'lgan kill'dan keyin `tradeWindowSeconds × tickRate` ichida o'sha `killer` o'ldirilsa, o'ldirgan jamoadoshga `tradeKills++`; o'lgan jamoadosh uchun KAST'ning T sharti bajariladi. Survive: roundda `victim` bo'lmagan.
- `rating` ustuni bu bosqichda `null` qoladi (formula spec'da yo'q).

- [ ] Step 1: Testlar — `kdUsesMaxDeathsOne` (10 kill, 0 death → 10.0), `hsPercentZeroWhenNoKills`, `adrCapsPerVictimAt100PerRound` (bir roundda bir qurbonga 150 zarar → 100), `kastCountsTradeRound`, `entryIsFirstKillOfTeamInRound`, `tradeWithinFiveSeconds` va `tradeAfterSixSecondsNotCounted` (tick_rate 64: 320 tick ichida/tashqarisida), `emptyMatchProducesZeroStatsWithoutError`.
- [ ] Step 2–5: TDD; Commit `feat(analysis): add pure stats calculator (K/D, HS%, ADR, KAST, entry, trade, clutch)`.

---

### Task 5: `HighlightService`, `StatsService`, `AnalysisOrchestrator`

**Interfaces:**
- `HighlightService.replaceForMatch(long matchId, List<HighlightCandidate>, int tickRate, List<RoundFacts>)` — `highlights` ni `match_id` bo'yicha o'chirib, `tick_start/tick_end` ni clip qoidasiga ko'ra hisoblab yozadi.
- `StatsService.upsertForMatch(long matchId, Map<Long, PlayerMatchStatsValues>)` — `player_match_stats` upsert (1-reja T6 qatorlari ustiga `kast, adr, entry_kills, ...` yoziladi; FACEIT'dan kelgan kills/deaths demo qiymati bilan almashtiriladi).
- `AnalysisOrchestrator.analyze(long demoId)` — `FactsLoader.load` → barcha `HighlightDetector` bean'lari → `ClutchDetector.attempts` → `StatsCalculator` → ikkala servis → `Demo.transitionTo(ANALYZED)`. `@Transactional`. Xato → `demos.status=FAILED`, error.
- 2-reja `DemoParsedListener` shu metodni chaqiradi (Modify: `messaging/DemoParsedListener.java`).

- [ ] Step 1: Integratsion testlar (Testcontainers, sintetik qatorlar SQL bilan) — `analyzeWritesHighlightsAndStatsAndMarksAnalyzed`, `clipTicksUsePreAndPostSecondsClampedToRound` (tick_rate 64, kill tick 1000, round start 900 → tick_start 900; tick_end 1128), `reanalysisReplacesHighlightsAndUpdatesStats`.
- [ ] Step 2–5: TDD; Commit `feat(analysis): orchestrate highlight detection and stats on demo.parsed`.

---

### Task 6: REST API va Win Rate

**Interfaces:**
- `GET /api/v1/matches/{matchId}/highlights` → `[{ id, type, playerId (faceit), nickname, roundNumber, tickStart, tickEnd }]`, filtr `?type=ACE&playerId=`.
- `GET /api/v1/players/{playerId}/highlights?type=&limit=50&offset=0` → shu shakl + `matchId, mapName, startedAt`.
- Servis metodlari (4-reja bot shularni chaqiradi): `HighlightService.latestForPlayer(String faceitPlayerId, int limit) -> List<HighlightResponse>`, `HighlightService.forMatch(String faceitMatchId, HighlightType type /*nullable*/, String faceitPlayerId /*nullable*/)`, `StatsService.aggregate(String faceitPlayerId) -> PlayerStatsResponse`.
- `record HighlightResponse(long id, HighlightType type, String playerId, String nickname, int roundNumber, int tickStart, int tickEnd, String matchId, String mapName, Instant startedAt)`; `record PlayerStatsResponse(int matches, double winRate, double kd, double hsPercent, double adr, double kast, double entryKillsPerMatch, double tradeKillsPerMatch, double clutchPercent)`.
- `GET /api/v1/players/{playerId}/stats` → `{ matches, winRate, kd, hsPercent, adr, kast, entryKillsPerMatch, tradeKillsPerMatch, clutchPercent }` — `player_match_stats` + `matches` bo'yicha agregat; Win Rate: `history` natijalari saqlanishi uchun `matches` ga `winner_team` va `player_match_stats` ga `won BOOLEAN` qo'shiladi (`V3` ga kiritiladi; 1-reja `MatchService.getStats` `Team Win` dan `won` ni to'ldiradi — Modify).
- Testlar: `matchHighlightsFilteredByType`, `playerStatsAggregatesAcrossMatches` (2 match: won/lost → winRate 0.5), `playerStatsWithNoMatchesReturnsZeros`.
- Commit `feat(analysis): expose highlights and aggregated player stats endpoints`.

---

### Task 7: Frontend — statistika kartalari va highlight ro'yxati

**Interfaces:**
- `StatsCards({ stats: PlayerStatsResponse })` — 8 karta: K/D, HS%, ADR, KAST, Entry/match, Trade/match, Clutch %, Win Rate; Recharts `RadialBarChart` faqat Win Rate va KAST uchun.
- `HighlightList({ items })` — tur badge (ACE qizil, CLUTCH binafsha, boshqalar kulrang), round, o'yinchi, match havolasi; filtr `Select` tur bo'yicha.
- `PlayerPage` ga `StatsCards` va "Highlights" tab; `MatchPage` ga highlight bo'limi; `/players/:id/highlights` sahifasi.
- Testlar: `StatsCards.test.tsx` (`K/D 1.79`, `Win Rate 50%` ko'rinadi), `HighlightList.test.tsx` (type filter 'ACE' faqat ACE qoldiradi). E2E (`e2e/search-flow.spec.ts` kengaytiriladi): match sahifasida `ACE` badge ko'rinadi.
- Commit `feat(frontend): add stats cards and highlights list`.

---

## O'z-o'zini tekshirish

- Spec 7: har tur uchun detektor (T2, T3), ustunlik qoidasi (T2), clutch faqat yutilganda (T3), tick_start/end clip konfiguratsiyasi (T5), ninja chegaralari konfiguratsiyada (T3). Spec 8: barcha 8 ko'rsatkich (T4, Win Rate T6). Spec 14: har detektor uchun ijobiy + chegaraviy testlar (T2–T4). Spec 17: `highlights` render-tayyor (T5).
- 2-rejaga qaytgan bog'liqlik: parser `rounds.bomb_*`, `kills.*_side`, `assister_id` maydonlarini to'ldirishi kerak — 2-reja T5 `Facts` ga kiritilgan, V3 ustunlarni qo'shadi.
