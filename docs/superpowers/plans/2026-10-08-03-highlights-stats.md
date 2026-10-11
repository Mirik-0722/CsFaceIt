# 3-quyi loyiha: Highlight va Statistika — Implementatsiya Rejasi (2026-10-10 qayta ko'rilgan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Bu tahrir nimani o'zgartirdi:** (1) foydalanuvchi qaroriga ko'ra **yangi test yozilmaydi** — har vazifa mavjud testlarni bir marta ishga tushirish va haqiqiy demo ustidagi aniq tekshiruv bilan tugaydi; (2) 2-rejaning haqiqiy kodi va sxemasi asos qilib olindi: bomb/side/assister ustunlari `V2` da bor, `V3` ularni qo'shmaydi; (3) 2-rejaning yakuniy review'i ko'rsatgan bo'shliq yopiladi: parser ikki yangi fakt yozadi — har roundning tarkibi va tomonlari (`round_players`) hamda round hal bo'lgan tick (`rounds.decided_tick`); (4) ADR qoidasi aniqlashtirildi; (5) tahlil xatosi demoni `FAILED` qilmaydi; (6) vazifalar "vertikal" qilib qayta bo'lindi — har biri ishlab turgan stack'da tekshiriladigan natija beradi; (7) frontendga demo boshqaruv paneli qo'shildi.

**Goal:** `demo.parsed` xabari kelganda backend xom faktlardan (rounds, round_players, kills, damages) o'yinchi-match statistikasini `player_match_stats` ga va highlight'larni `highlights` ga yozadi, `demos.status` ni `ANALYZED` qiladi; natija REST API va UI orqali ko'rinadi.

**Architecture:** Parser ikki fakt bilan kengayadi (Task 1); qolgan hammasi backend'dagi yangi `analysis/` paketida. `FactsLoader` (`JdbcClient`, faqat o'qish) bir matchning faktlarini `MatchFacts` ga yuklaydi. Undan keyin hammasi sof funksiya: `RoundTimeline` (kim tirik), `StatsCalculator`, highlight detektorlari. `AnalysisService` (tranzaksiyasiz) shularni chaqiradi va natijani `AnalysisPersistence` ga beradi: u bitta tranzaksiyada, demo qatori qulfi ostida, eski highlight'larni o'chirib yangisini yozadi, statistikani yangilaydi va holatni `ANALYZED` qiladi. `V1` va `V2` o'zgarmaydi.

**Tech Stack:** Rust parser (mavjud: Tokio, lapin, sqlx, demoparser); Spring Boot 3.5 (`JdbcClient`, JPA, Spring AMQP), Flyway `V3__analysis.sql`; React 19, TanStack Query, shadcn/ui (yangi kutubxona qo'shilmaydi).

**Spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (4, 7, 8, 11, 12, 16.5, 17-bo'limlar)

**Branch:** `feature/highlights-stats`, `feature/demo-pipeline` ustiga quriladi.

## Global Constraints

- **Yangi test yozilmaydi** (foydalanuvchi qarori). Mavjud testlar (backend 255, Vitest 120, Playwright 1) yashil qolishi shart; mavjud test faqat reja ataylab o'zgartirgan xatti-harakat uchun va eng kichik hajmda tahrirlanadi (masalan, sahifa yangi so'rov yuborsa — shu so'rov uchun mock javob qo'shiladi).
- `parser/` faqat Task 1 da o'zgaradi. `V1__init.sql` va `V2__demo_pipeline.sql` o'zgartirilmaydi; sxemaga hamma qo'shimcha bitta `V3__analysis.sql` da (Task 1 yaratadi, keyingi vazifalar unga tegmaydi).
- **Parser faqat fakt yozadi** (spec 4): `round_players` va `decided_tick` — o'lchov, talqin emas. Chegara va qoidalar backend'da.
- **Round tarkibi va tomonlar:** `round_players` (har roundda o'ynagan o'yinchi va uning `CT`/`T` tomoni) asosiy manba; unga shu roundning kill hodisalarida tomoni bilan uchragan o'yinchilar qo'shiladi (eski parse yoki pozitsiyasiz demo uchun zaxira). Bir roundda turli tomondagi ikki o'yinchi — raqib, bir tomondagilar — jamoadosh. Round tarkibida yo'q o'yinchi shu roundda o'ynamagan: u KAST maxrajiga, tiriklar soniga va `roundsPlayed` ga kirmaydi.
- **Raqib kill'i:** `killer_id` bor, `killer_id != victim_id`, killer va victim shu roundda turli tomonda. Faqat shular kill, multi-kill, entry, trade va maxsus kill highlight'lariga kiradi. Jamoadoshni o'ldirish, o'z-o'zini o'ldirish va dunyo/bomba o'limi — faqat o'lim (`deaths`).
- **Round hal bo'lgan tick** — `rounds.decided_tick` (`NULL` bo'lsa `end_tick`). Undan keyingi o'limlar clutch vaziyatini yaratmaydi.
- **Highlight qoidalari** — spec 7-jadval: `ACE` (roundda ≥5 raqib kill'i), `K4`/`K3` (aynan 4/3; yuqori tur bo'lsa pastkisi yozilmaydi), `CLUTCH_1V1..1V5` (faqat round yutilganda), `NO_SCOPE` (`noscope` va qurol ∈ `awp`, `ssg08`, `g3sg1`, `scar20`), `KNIFE_KILL` (qurol nomi `knife` bilan boshlanadi yoki `bayonet`), `WALLBANG` (`wallbang`), `SMOKE_KILL` (`thrusmoke`), `NINJA_DEFUSE`.
- **`NINJA_DEFUSE` soddalashtirilgan:** bomba zararsizlantirilgan tickda raqib tomondan kamida bir o'yinchi tirik. Spec'dagi "defuse boshlanishida raqib yaqin atrofda emas" sharti **qo'llanmaydi**, chunki parser tick bo'yicha pozitsiyalarni saqlamaydi. Bu og'ish yo'l xaritasida qayd etiladi.
- **Formulalar** (spec 8): `K/D = kills / max(deaths, 1)`; `HS% = headshot kill'lar / kills` (kills = 0 → 0); `KAST` — o'yinchi kill qilgan, assist bergan, tirik qolgan yoki o'limi trade qilingan roundlar ulushi; Entry — roundning birinchi raqib kill'i (har roundda bitta); Trade — jamoadoshining o'limidan `analysis.trade-window-seconds` (5) ichida uning qotilini o'ldirish; `Clutch % = yutilgan / urinishlar`; `Win Rate = yutilgan matchlar / natijasi ma'lum matchlar`.
- **ADR:** `damages.damage_health` — zarbaning xom qiymati (AWP headshot 400 dan ortiq). Har roundda har o'yinchining sog'lig'i 100 dan boshlanadi; zarbalar tick tartibida ko'riladi va har biri qurbonning **qolgan sog'lig'i bilan chegaralanadi** (kim urganidan qat'i nazar sog'liq kamayadi); faqat raqibga berilgan zarar hisobga olinadi. `ADR = Σ zarar / o'ynalgan roundlar`. Bu spec'dagi "har raqib bo'yicha 100 bilan cheklash" ning aniqroq shakli: 2-rejada shu qoida professional matchning o'n o'yinchisi uchun HLTV qiymatlarini aynan bergan.
- **Chegaralar konfiguratsiyada** (spec 16.5) — `analysis.*` (Task 2), kodda sehrli son yo'q.
- **`tick_start`/`tick_end`:** `tick_start = max(round.start_tick, firstTick − pre × tick_rate)`, `tick_end = min(round.end_tick, lastTick + post × tick_rate)`; `pre = analysis.clip.pre-seconds` (3), `post = analysis.clip.post-seconds` (2); `tick_rate` — `demos.tick_rate` (yo'q bo'lsa 64).
- **Idempotentlik:** bir matchni qayta tahlil qilish highlight'larni almashtiradi va statistikani yangilaydi; takroriy `demo.parsed` zararsiz. Tahlil paytida demo qayta yuklangan yoki qayta parse qilingan bo'lsa, eskirgan natija yozilmaydi.
- **Tahlil xatosi `FAILED` emas:** parse muvaffaqiyatli bo'lgan demoning tahlili yiqilsa, holat `PARSED` qoladi, sabab `demos.error` ga yoziladi va tahlil `POST …/demo/analyze` bilan qayta boshlanadi (faktlar joyida, faylni qayta yuklash shart emas).
- **Foizlar API'da 0–100 oralig'ida**, bir xonali kasr bilan; `kd` ikki xonali, `adr` bir xonali. Ma'lumot bo'lmagan ko'rsatkich — `null` (nol emas).
- 1–2-rejalar andozalari: tranzaksiyasiz servis + alohida `@Transactional` persistence bean; demo holati faqat qator qulfi ostida o'zgaradi; tranzaksiya ichida tarmoq so'rovi yo'q; umumiy `ApiError`; `matchId`/`playerId` uchun mavjud `@Pattern` konstantalari.
- Sirlar faqat muhit o'zgaruvchilaridan; `.env` yaratilmaydi. Hujjat tili o'zbekcha; kod, izoh, log va commit matnlari inglizcha.

## Review Focus

Test yozilmagani uchun quyidagilar review'da kodni o'qib tekshiriladi va egasi vazifaning "Tekshirish" qadamida haqiqiy demo ustida mustaqil SQL bilan solishtiriladi.

1. **Jamoadoshni o'ldirish, o'z-o'zini o'ldirish, dunyo/bomba o'limi:** kill sifatida sanalmaydi, o'lim sifatida sanaladi; multi-kill, entry va trade'ga kirmaydi (Task 2, 3, 4).
2. **Round hal bo'lgandan keyingi o'limlar** (bomba portlashi, vaqt tugashi yoki defuse'dan keyin): clutch vaziyatini yaratmaydi — aks holda yutilgan roundda soxta clutch highlight chiqadi (Task 1, 3, 4).
3. **Tomon almashishi, overtime va o'yinchi almashishi:** tomon har roundda `round_players` dan olinadi; round raqami 24 dan katta roundlar ham hisobga olinadi; matchni tark etgan o'yinchi keyingi roundlarda tirik deb sanalmaydi (Task 1, 2, 3).
4. **Qayta tahlil va poyga:** highlight'lar dublikatsiz; tahlil davomida demo qayta yuklansa eskirgan natija `ANALYZED` deb yozilmaydi (Task 2, 4).
5. **Ma'lumot yo'q holatlar:** demo tahlil qilinmagan o'yinchi, `steam:<id>` vaqtinchalik o'yinchi yoki `round_players` siz eski parse — API `null` qaytaradi, nolga bo'lish va `NaN` yo'q; UI "—" ko'rsatadi (Task 2, 5, 6).

---

## Fayl tuzilmasi

```
parser/src/{parse,sink}.rs, parser/README.md                    # Task 1: round_players, decided_tick
backend/src/main/resources/db/migration/V3__analysis.sql        # Task 1 (to'liq)
backend/src/main/java/io/csfaceit/backend/analysis/
├── AnalysisProperties.java, AnalysisService.java, AnalysisPersistence.java
├── facts/      Side, KillFact, DamageFact, RoundFacts, MatchFacts, FactsLoader
├── stats/      PlayerMatchStatsValues, StatsCalculator
├── timeline/   RoundTimeline, ClutchAttempt
├── highlight/  HighlightType, HighlightCandidate, HighlightDetector, MultiKillDetector, SpecialKillDetector,
│               ClutchDetector, NinjaDefuseDetector, Highlight (entity), HighlightRepository
└── api/        HighlightController, PlayerStatsController, HighlightQueryService, StatsQueryService,
                dto/HighlightResponse, dto/HighlightPageResponse, dto/PlayerAggregateStatsResponse
frontend/src/components/StatsCards.tsx, HighlightList.tsx, DemoPanel.tsx
frontend/src/pages/PlayerHighlightsPage.tsx, frontend/src/lib/adminKey.ts
```

## Tekshirish muhiti (hamma vazifa uchun)

- Soxta FACEIT stack'i: `docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait`; UI/API `http://localhost:3000`, admin kaliti `dev-admin-key`, namunaviy match `1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`. Ish tugagach `down`.
- Haqiqiy demo: `dev/fake-faceit/__files/demos/local.dem` (git-ignore, 390 MB; FACEIT matchi, de_mirage). Yuklash: `curl -H "X-API-Key: dev-admin-key" -F file=@dev/fake-faceit/__files/demos/local.dem http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/upload`. Parse natijasi (2-rejada o'lchangan): 24 round, 165 kill qatori, 609 damage, 8 896 heat bin; 4 wallbang, 16 smoke orqali, 45 assistli kill; 4 round defuse bilan (6, 10, 15, 16), 2 round portlash bilan yutilgan.
- Mustaqil solishtirish uchun SQL `docker compose … exec -T postgres psql -U csfaceit -d csfaceit` orqali ishga tushiriladi.

---

### Task 1: `V3__analysis.sql` va parser'ning ikki yangi fakti (`round_players`, `rounds.decided_tick`)

**Files:**
- Create: `backend/src/main/resources/db/migration/V3__analysis.sql`
- Modify: `parser/src/parse.rs`, `parser/src/sink.rs` (kerak bo'lsa `parser/src/main.rs` — faqat log qatoridagi sanoq uchun), `parser/README.md`, `README.md` (faktlar ro'yxati)

**Interfaces:**
- `V3__analysis.sql` (aynan, to'liq — keyingi vazifalar o'zgartirmaydi):
  - `CREATE TABLE round_players (match_id BIGINT NOT NULL REFERENCES matches(id), round_number INTEGER NOT NULL, player_id BIGINT NOT NULL REFERENCES players(id), side VARCHAR(2) NOT NULL, PRIMARY KEY (match_id, round_number, player_id));`
  - `ALTER TABLE rounds ADD COLUMN decided_tick INTEGER;`
  - `ALTER TABLE player_match_stats ADD COLUMN rounds_played INTEGER, ADD COLUMN entry_kills INTEGER, ADD COLUMN trade_kills INTEGER, ADD COLUMN clutch_attempts INTEGER, ADD COLUMN clutch_wins INTEGER, ADD COLUMN won BOOLEAN;` — `rounds_played IS NULL` "bu qator demo'dan tahlil qilinmagan" degani.
  - `CREATE INDEX idx_pms_match ON player_match_stats (match_id);` `CREATE INDEX idx_highlights_match ON highlights (match_id);`
- Parser, `rounds.decided_tick`: sanalgan roundni yopgan `round_end` hodisasining ticki (`Round` ga `decided_tick: i32`; `end_tick` ma'nosi o'zgarmaydi). Bir round uchun ikki marta kelgan `round_end` da birinchisi olinadi.
- Parser, `round_players`: har sanalgan round uchun, shu roundda tanlangan pozitsiyalarda (mavjud ikkinchi o'tish, har 32 tick, faqat tirik o'yinchilar) uchragan har SteamID va uning **shu roundda birinchi uchragan** tomoni. Qatorlar boshqa faktlar bilan bitta tranzaksiyada yoziladi: match bo'yicha `DELETE`, so'ng `INSERT` (mavjud `UNNEST` uslubida); o'yinchi id'lari mavjud `resolve_players` orqali. Pozitsiyalari o'qilmagan demo `round_players` siz `PARSED` bo'ladi — shu holat endi `debug` emas, `warn` darajasida log qilinadi (2-reja review'idan ko'chirilgan).
- Muvaffaqiyatli parse log qatoriga `round_players` soni qo'shiladi. `parser/README.md` va ildiz `README.md` dagi faktlar bo'limiga ikkala fakt ta'rifi.
- Moslik: backend Flyway'ni ishga tushganda qo'llaydi, parser esa `demo.parse` navbati e'lon qilinguncha kutadi — shuning uchun parser `V3` siz bazaga yozmaydi; bu tartib README'da bir jumla bilan aytiladi. `V3` dan oldin parse qilingan demolar `round_players` siz qoladi: ular uchun qayta import/upload tavsiya etiladi.

- [ ] **Step 1:** Migratsiya, parser o'zgarishlari, README'lar.
- [ ] **Step 2: Tekshirish.** `./mvnw test` → 255 yashil (V3 mavjud entity'lar bilan `ddl-auto=validate` dan o'tadi). `cargo build --release` va `cargo clippy --all-targets -- -D warnings` toza (2-rejadagi usulda). Soxta stack'da (`down -v` dan keyin) haqiqiy demo → `PARSED`, avvalgi sonlar o'zgarmagan (24 / 165 / 609 / 8 896); SQL: (a) har roundda `round_players` da 10 qator (5 `CT` + 5 `T`), jami 240 — farq bo'lsa sababi ko'rsatiladi; (b) har (round, o'yinchi) uchun tomon shu rounddagi `kills.killer_side`/`victim_side` bilan zid emas (zid juftliklar so'rovi 0 qator); (c) har o'yinchi 12-rounddan 13-roundga o'tganda tomonini almashtirgan; (d) hamma roundda `start_tick <= decided_tick <= end_tick`; defuse bilan yutilgan roundlarda (6, 10, 15, 16) `decided_tick` `bomb_defused_tick` dan bir necha tick farq qiladi (ikkalasi ko'rsatiladi); (e) `decided_tick` dan keyin o'lim bo'lgan roundlar ro'yxati (Task 3 clutch tekshiruvi uchun hisobotga yoziladi); (f) faylni qayta yuklash → sonlar bir xil, dublikat yo'q. So'ng `down`.
- [ ] **Step 3: Commit** — `feat(parser): record round rosters with sides and the tick a round was decided`

---

### Task 2: Faktlarni yuklash, asosiy statistika va `demo.parsed` → `ANALYZED` zanjiri

**Files:**
- Create: `analysis/AnalysisProperties.java`, `analysis/AnalysisService.java`, `analysis/AnalysisPersistence.java`, `analysis/facts/{Side,KillFact,DamageFact,RoundFacts,MatchFacts,FactsLoader}.java`, `analysis/stats/{PlayerMatchStatsValues,StatsCalculator}.java`
- Modify: `match/PlayerMatchStats.java`, `match/PlayerMatchStatsRepository.java`, `match/MatchPersistence.java`, `messaging/DemoParsedListener.java`, `messaging/DemoDlqListener.java`, `messaging/DemoMetrics.java`, `demo/Demo.java`, `demo/DemoPersistence.java`, `demo/DemoController.java`, `demo/DemoService.java`, `common/api/ApiExceptionHandler.java` (kerak bo'lsa), `application.yml`, `README.md`

**Interfaces:**
- `PlayerMatchStats` ga `V3` ustunlariga mos maydonlar: `Integer roundsPlayed, entryKills, tradeKills, clutchAttempts, clutchWins`, `Boolean won`.
- `AnalysisProperties` (`@ConfigurationProperties("analysis")`, tekshiriladigan record; hammasi musbat): `clip.pre-seconds: 3`, `clip.post-seconds: 2`, `trade-window-seconds: 5`, `ninja.defuse-seconds: 10` — `application.yml` da shu qiymatlar bilan.
- Faktlar (record'lar; barcha id'lar — `players.id`): `enum Side { CT, T }` (`opposite()` bilan); `KillFact(int tick, Long killerId, long victimId, Long assisterId, String weapon, boolean headshot, boolean wallbang, boolean noscope, boolean thrusmoke, Side killerSide, Side victimSide)` — `killerId` `null`: dunyo/bomba o'limi; `DamageFact(int tick, Long attackerId, long victimId, int damageHealth)`; `RoundFacts(int roundNumber, Side winnerSide /*nullable*/, int startTick, int endTick, int decidedTick, Integer bombPlantedTick, Integer bombDefusedTick, Long defuserId, Map<Long, Side> sides, List<KillFact> kills, List<DamageFact> damages)` — `sides` round tarkibi (Global Constraints: `round_players`, unga kill hodisalaridagi o'yinchilar qo'shiladi; zid kelsa `round_players` ustun), `decidedTick` — `decided_tick` yoki u `NULL` bo'lsa `endTick`, ro'yxatlar `(tick, id)` tartibida; yordamchilar `boolean enemies(Long a, Long b)` (ikkalasi tarkibda va tomonlari har xil), `Set<Long> players(Side side)`. `MatchFacts(long matchId, int tickRate, List<RoundFacts> rounds)` + `Set<Long> players()` (hamma roundlar tarkibining birlashmasi).
- `FactsLoader.load(long matchRowId, int tickRate) -> MatchFacts`: `JdbcClient` bilan `rounds`, `round_players`, `kills`, `damages` — har biri bitta so'rov, `ORDER BY round_number, tick, id` (mos ravishda); `rounds` da qatori yo'q round raqamli qatorlar tashlab yuboriladi; bazadagi noma'lum tomon qiymati — yo'q qiymat.
- `PlayerMatchStatsValues(int kills, int deaths, int assists, int headshots, BigDecimal adr, int roundsPlayed, Boolean won, BigDecimal kast, Integer entryKills, Integer tradeKills, Integer clutchAttempts, Integer clutchWins)` — oxirgi beshtasini bu vazifa `null` qoldiradi (Task 3 to'ldiradi).
- `StatsCalculator.calculate(MatchFacts) -> Map<Long, PlayerMatchStatsValues>` (sof; kalitlar — `facts.players()`): `kills` — raqib kill'lari; `deaths` — o'yinchi `victim` bo'lgan barcha qatorlar; `assists` — o'yinchi `assister` va qurbon shu roundda uning raqibi; `headshots` — `headshot` bo'lgan raqib kill'lari; `roundsPlayed` — tarkibida o'yinchi bor roundlar soni; `adr` — Global Constraints'dagi qoida, maxraj `roundsPlayed`, 2 xonagacha `HALF_UP`; `won` — match g'olibi oxirgi roundni yutadi: o'yinchi oxirgi round tarkibida va o'sha roundning `winnerSide` ma'lum bo'lsa, tomoni unga tengmi; aks holda `null`.
- `AnalysisPersistence` (`@Transactional` metodlar):
  - `Optional<Claim> claim(long demoId)` (faqat o'qish) — demo bor va holati `PARSED` yoki `ANALYZED` bo'lsa `Claim(long demoId, long matchRowId, String faceitMatchId, int tickRate, Instant updatedAt)` (`tick_rate` `NULL` → 64).
  - `boolean store(Claim claim, Map<Long, PlayerMatchStatsValues> stats)` — `DemoRepository.findByIdForUpdate`; holat `PARSED`/`ANALYZED` emas yoki `updatedAt` `claim` dagidan farq qilsa `false` (hech narsa yozilmaydi). Aks holda: shu matchning barcha `player_match_stats` qatorlarida `rounds_played, kast, entry_kills, trade_kills, clutch_attempts, clutch_wins` `NULL` qilinadi (oldingi tahlil qoldig'i qolmasligi uchun); `stats` dagi har o'yinchi uchun qator topiladi yoki yaratiladi va `kills, deaths, assists, headshots, adr, rounds_played, kast, entry_kills, trade_kills, clutch_attempts, clutch_wins` yoziladi; `won` faqat qatorda `NULL` bo'lsa yoziladi (FACEIT'ning rasmiy natijasi ustun); holat `PARSED` bo'lsa `ANALYZED` ga o'tadi (bu `error` ni ham tozalaydi). (Task 4 bu metodga highlight'larni qo'shadi.)
- `AnalysisService.analyze(long demoId) -> Outcome { ANALYZED, SKIPPED, STALE }` (tranzaksiyasiz): `claim` → bo'sh bo'lsa `SKIPPED` (INFO) → `FactsLoader.load` → `StatsCalculator.calculate` → `store` → `false` bo'lsa `STALE` (INFO: yangi upload/parse o'zi xabar beradi). Istisnolar ushlanmaydi.
- `DemoParsedListener.onParsed`: avvalgidek `demo.pipeline.parsed` ni oshiradi, so'ng `AnalysisService.analyze` ni chaqiradi va davomiylikni `demo.pipeline.stage.duration{stage="analyze"}` ga yozadi (`DemoMetrics` ga `startAnalyze()/analyzeFinished(sample)`). 2-rejadagi "holat o'qilmasa WARN yozib sanash" shoxi olib tashlanadi (holatni endi `claim` o'qiydi); tahlil istisnosi tashqariga chiqadi va listener 3 marta urinadi.
- **Tahlil xatosi yo'li** (`DemoDlqListener`, kelib chiqishi `demo.parsed`): demo endi `FAILED` qilinmaydi. Yangi `DemoPersistence.noteAnalysisFailure(long demoId, String error) -> boolean` — qator qulfi ostida, holat `PARSED` bo'lsa `demos.error` ga qat'iy jumla yoziladi (`Analyzing the demo failed after 3 attempts. The parsed data is kept; start the analysis again.`), holat o'zgarmaydi (`Demo` ga holatni o'zgartirmaydigan `noteError(String)`); yozilgan bo'lsa `failed{stage="analyze"}` bir marta sanaladi. `ANALYZED` demo (qayta tahlil yiqilgan) o'zgarmaydi — faqat ERROR log va sanoq. `demo.import`/`demo.parse` kelib chiqishli xabarlar uchun xatti-harakat o'zgarmaydi.
- Qayta tahlil: `POST /api/v1/matches/{matchId}/demo/analyze` (`X-API-Key` — `SecurityConfig` allaqachon talab qiladi) → `DemoService.requestAnalysis(String faceitMatchId)`: demo yo'q → 404 `DEMO_NOT_FOUND`; holat `PARSED`/`ANALYZED` emas → 409 `DEMO_NOT_PARSED`; aks holda `demo.parsed` ga `DemoParsed(demoId, faceitMatchId)` yuboriladi va 202 + `DemoResponse` qaytadi. Bazaga yozuv yo'q.
- `MatchPersistence.storePlayerStats` (FACEIT yozuvchisi): `rounds_played` `NULL` bo'lgan qatordagina `kills, deaths, assists, headshots, adr` ni yozadi (tahlil qilingan qatorni buzmaydi); `won` ni har doim jamoaning `TeamStatsResponse.win()` qiymatidan yozadi.
- README: "Analysis" bo'limi — nima hisoblanadi, `analysis.*` sozlamalari, qayta tahlil `curl` misoli, tahlil xatosidan keyingi holat (`PARSED` + `error`) va undan chiqish; holatlar jadvali va metrikalar jadvali yangilanadi.

- [ ] **Step 1:** Record'lar, yuklovchi, kalkulyator, persistence, servis, listener'lar, endpoint, FACEIT yozuvchisi, README.
- [ ] **Step 2: Tekshirish.** `./mvnw test` → 255 yashil. Soxta stack'da haqiqiy demoni yuklab `ANALYZED` gacha kutish, so'ng SQL bilan: (a) `demos.status = 'ANALYZED'`, `error IS NULL`; (b) match bo'yicha `player_match_stats` da 10 qator, hammasida `rounds_played = 24`; (c) `sum(deaths) = 165`; (d) `sum(kills)` = `SELECT count(*) FROM kills WHERE killer_id IS NOT NULL AND killer_id <> victim_id AND killer_side <> victim_side`; (e) har o'yinchi uchun `adr` mustaqil SQL (oyna funksiyasi bilan qolgan sog'liq, tomonlar `round_players` dan, faqat raqibga zarar) natijasiga ±0.01 aniqlikda teng — ikkala ustun yonma-yon ko'rsatiladi; (f) `won`: 5 ta `true`, 5 ta `false`, va `true` lar oxirgi round g'olibi tomonidagi o'yinchilar; (g) `POST …/demo/analyze` → 202, qatorlar `id` lari va qiymatlari o'zgarmagan; kalitsiz → 401; `QUEUED`/`FAILED` demo uchun → 409 `DEMO_NOT_PARSED`; (h) faylni qayta yuklash → `STORED → PARSED → ANALYZED`, qiymatlar bir xil; (i) `GET …/matches/{id}/stats` (soxta FACEIT statistikasi) dan keyin tahlil qilingan qatorlar o'zgarmagan, FACEIT o'yinchilari qatorlarida `rounds_played IS NULL` va `won` to'ldirilgan; (j) tahlil xatosi: `ALTER TABLE damages RENAME COLUMN damage_health TO damage_health_x`, `POST …/demo/analyze` → uch urinishdan keyin holat hali `ANALYZED` (o'zgarmagan), log'da ERROR; demoni qayta yuklab `PARSED` paytida xuddi shu buzilish bilan → holat `PARSED`, `error` qat'iy jumla, `demo_pipeline_failed_total{stage="analyze"}` +1; ustun nomini qaytarib `POST …/demo/analyze` → `ANALYZED`, `error IS NULL`; (k) `/actuator/prometheus` da `demo_pipeline_stage_duration_seconds_count{stage="analyze"}` ≥ 1. So'ng `down`.
- [ ] **Step 3: Commit** — `feat(analysis): analyze parsed demos into per-match player stats`

---

### Task 3: `RoundTimeline` va KAST, Entry, Trade, Clutch statistikasi

**Files:**
- Create: `analysis/timeline/RoundTimeline.java`, `analysis/timeline/ClutchAttempt.java`
- Modify: `analysis/stats/StatsCalculator.java`, `README.md`

**Interfaces:**
- `RoundTimeline.of(RoundFacts round) -> RoundTimeline` (sof). Round boshida tarkibdagi (`round.sides`) hamma o'yinchi tirik; o'limlar — `kills` qatorlari (`victimId`), `(tick, id)` tartibida; bir tickdagi o'limlar birga qo'llanadi.
  - `Set<Long> aliveAt(Side side, int tick)` — shu tomonning shu tickgacha (shu tick ham) o'lmagan o'yinchilari.
  - `Optional<ClutchAttempt> clutch(Side side)` — `round.decidedTick` gacha (shu tick ham) shu tomonda aynan bitta o'yinchi tirik qolgan va raqib tomonda `N >= 1` tirik bo'lgan birinchi lahza: `ClutchAttempt(long playerId, int roundNumber, int tick, int enemiesAlive /* 1..5, 5 dan katta bo'lsa 5 */, boolean won)`; `won` — `round.winnerSide == side` (o'yinchi keyin o'lgan bo'lsa ham). Tomon birdan 0 ga tushsa, lahza `decidedTick` dan keyin kelsa yoki tomon boshidanoq bir kishidan iborat bo'lsa — urinish yo'q.
- `StatsCalculator` (konstruktoriga `AnalysisProperties` qo'shiladi) qo'shimcha maydonlarni to'ldiradi (hammasi `facts.players()` dagi har o'yinchi uchun, hech qachon `null` emas):
  - `entryKills` — roundning `(tick, id)` bo'yicha birinchi raqib kill'i killeriga +1.
  - Trade: raqib kill'i `K2` (killer `B`, victim `X`, tick `t2`) trade hisoblanadi, agar `X` shu roundda `B` ning jamoadoshi `V` ni (`V != B`) `t1` da o'ldirgan va `t2 − window <= t1 <= t2` bo'lsa (`window = trade-window-seconds × tickRate`, yaxlitlangan; `K2` ning o'zi `t1` hodisasi bo'la olmaydi). `B` ga `tradeKills` +1 (bir kill uchun bir marta); har bunday `V` shu roundda "trade qilingan".
  - `kast` — `100 × (K ∨ A ∨ S ∨ T bo'lgan roundlar) / roundsPlayed`, 2 xonagacha, faqat o'yinchi tarkibida bo'lgan roundlar bo'yicha: `K` — roundda raqib kill'i bor; `A` — raqib qurbonga assist bor; `S` — roundda o'lmagan (`victim` bo'lmagan); `T` — trade qilingan.
  - `clutchAttempts`/`clutchWins` — har round va har tomon uchun `RoundTimeline.clutch` natijalaridan.
- README'ning "Analysis" bo'limiga shu ko'rsatkichlar ta'rifi.

- [ ] **Step 1:** `RoundTimeline`, kalkulyator kengaytmasi, README.
- [ ] **Step 2: Tekshirish.** `./mvnw test` → 255 yashil. Soxta stack'da haqiqiy demo `ANALYZED` (yoki `POST …/demo/analyze`), so'ng SQL: (a) hamma qatorda `kast` 0–100 oralig'ida va `NULL` emas, `clutch_wins <= clutch_attempts`; (b) `sum(entry_kills)` = kamida bitta raqib kill'i bo'lgan roundlar soni (mustaqil SQL bilan); (c) `sum(trade_kills)` mustaqil SQL (kills jadvalini o'ziga `JOIN`, 5 × `tick_rate` oyna, tomonlar bo'yicha) natijasiga teng — ikkala son ko'rsatiladi; (d) bitta o'yinchi uchun KAST qo'lda: uning har rounddagi K/A/S/T belgilari SQL bilan chiqarilib, foiz hisoblanadi va `kast` bilan solishtiriladi; (e) clutch urinishlari ro'yxati (round, o'yinchi, `1vN`, yutdimi) log yoki SQL orqali ko'rsatiladi va ikkitasi `kills` qatorlari bilan qo'lda tasdiqlanadi; Task 1 hisobotidagi "`decided_tick` dan keyin o'lim bo'lgan" roundlardan birida shu kech o'limlar urinish yaratmagani ko'rsatiladi. So'ng `down`.
- [ ] **Step 3: Commit** — `feat(analysis): add round timeline with KAST, entry, trade and clutch stats`

---

### Task 4: Highlight detektorlari va `highlights` ga yozish

**Files:**
- Create: `analysis/highlight/{HighlightType,HighlightCandidate,HighlightDetector,MultiKillDetector,SpecialKillDetector,ClutchDetector,NinjaDefuseDetector,Highlight,HighlightRepository}.java`
- Modify: `analysis/AnalysisService.java`, `analysis/AnalysisPersistence.java`, `README.md`

**Interfaces:**
- `enum HighlightType { ACE, K4, K3, CLUTCH_1V1, CLUTCH_1V2, CLUTCH_1V3, CLUTCH_1V4, CLUTCH_1V5, NO_SCOPE, KNIFE_KILL, WALLBANG, SMOKE_KILL, NINJA_DEFUSE }`; `record HighlightCandidate(HighlightType type, long playerId, int roundNumber, int firstTick, int lastTick)`; `interface HighlightDetector { List<HighlightCandidate> detect(MatchFacts facts); }` — to'rtta `@Component` implementatsiya, hammasi sof.
- `MultiKillDetector`: round + killer bo'yicha raqib kill'lari soni `>= 5` → `ACE`, `4` → `K4`, `3` → `K3` (har juftlik uchun faqat bittasi); `firstTick`/`lastTick` — shu kill'larning birinchisi va oxirgisi.
- `SpecialKillDetector`: har raqib kill'i uchun alohida nomzodlar (bir kill bir nechta turga tushishi mumkin), `firstTick = lastTick = tick`: `KNIFE_KILL`, `NO_SCOPE`, `WALLBANG`, `SMOKE_KILL` — shartlar Global Constraints'da.
- `ClutchDetector`: har round va har tomon uchun `RoundTimeline.clutch(side)`; `won` bo'lsa `CLUTCH_1V{enemiesAlive}`; `firstTick` — urinish ticki, `lastTick` — `round.decidedTick`.
- `NinjaDefuseDetector`: `bombDefusedTick` va `defuserId` bor, defuser round tarkibida va raqib tomonda `aliveAt(raqib tomon, bombDefusedTick)` bo'sh emas → `NINJA_DEFUSE` (defuser uchun); `lastTick = bombDefusedTick`, `firstTick = bombDefusedTick − ninja.defuse-seconds × tickRate`.
- `Highlight` (JPA entity, `highlights` jadvali `V1` dagi shaklda: `id, match, player, type` (`EnumType.STRING`), `roundNumber, tickStart, tickEnd, createdAt`); `HighlightRepository`: `@Modifying` `deleteByMatchId(Long)` (o'qish so'rovlari Task 5 da).
- `AnalysisService`: barcha `HighlightDetector` bean'larini chaqirib nomzodlarni yig'adi. `AnalysisPersistence.store(Claim, Map<Long, PlayerMatchStatsValues>, List<HighlightCandidate>, MatchFacts)`: o'sha tranzaksiya va qulf ostida matchning eski highlight'larini o'chiradi va yangilarini yozadi; `tick_start`/`tick_end` Global Constraints'dagi qoida bo'yicha (roundi `facts` da topilmagan nomzod tashlab yuboriladi).
- README'ga highlight turlari jadvali va `NINJA_DEFUSE` cheklovi.

- [ ] **Step 1:** Detektorlar, entity, repository, servis va persistence kengaytmasi, README.
- [ ] **Step 2: Tekshirish.** `./mvnw test` → 255 yashil. Soxta stack'da haqiqiy demo tahlilidan keyin SQL: (a) `ACE`/`K4`/`K3` qatorlari `SELECT round_number, killer_id, count(*) … GROUP BY … HAVING count(*) >= 3` (raqib kill'lari, tomonlar bo'yicha) natijasiga aynan mos — juftliklar yonma-yon ko'rsatiladi, bir (round, o'yinchi) uchun ikki tur yo'q; (b) `WALLBANG`, `SMOKE_KILL`, `NO_SCOPE`, `KNIFE_KILL` sonlari `kills` dagi mos bayroqli raqib kill'lari soniga teng (`SELECT DISTINCT weapon FROM kills` ham ko'rsatiladi — pichoq nomlari qoidaga mosligini ko'rish uchun); (c) `CLUTCH_*` qatorlari soni `sum(clutch_wins)` ga teng; (d) `NINJA_DEFUSE` faqat defuse bilan yutilgan roundlarda (6, 10, 15, 16 ichidan), har biri uchun defuse tickida tirik raqiblar SQL bilan ko'rsatiladi; (e) hamma qatorda `round.start_tick <= tick_start <= tick_end <= round.end_tick`; (f) `POST …/demo/analyze` ni ikki marta chaqirgandan keyin highlight'lar soni o'zgarmagan (dublikat yo'q); (g) faylni qayta yuklash paytida (`STORED` holatida) kelgan eski `demo.parsed` xabari hech narsa yozmaydi (`SKIPPED`/`STALE` log qatori). So'ng `down`.
- [ ] **Step 3: Commit** — `feat(analysis): detect multi-kill, clutch, special-kill and ninja-defuse highlights`

---

### Task 5: REST API — highlight'lar va o'yinchining yig'ma statistikasi

**Files:**
- Create: `analysis/api/{HighlightController,PlayerStatsController,HighlightQueryService,StatsQueryService}.java`, `analysis/api/dto/{HighlightResponse,HighlightPageResponse,PlayerAggregateStatsResponse}.java`
- Modify: `analysis/highlight/HighlightRepository.java`, `player/PlayerController.java` (faqat konstanta ko'rinishi), `common/api/ApiExceptionHandler.java` (kerak bo'lsa), `README.md`

**Interfaces:**
- `record HighlightResponse(long id, HighlightType type, String playerId, String nickname, int roundNumber, int tickStart, int tickEnd, String matchId, String mapName, Instant startedAt)` — `playerId` = `players.faceit_id` (vaqtinchalik o'yinchida `steam:<id>`), `matchId` = FACEIT match id.
- `GET /api/v1/matches/{matchId}/highlights?type=&playerId=` → `List<HighlightResponse>`, tartib: `roundNumber, tickStart, id`. Match bazada yo'q yoki highlight yo'q → `[]`. Faqat bazadan o'qiydi (FACEIT'ga so'rov yo'q).
- `GET /api/v1/players/{playerId}/highlights?type=&offset=0&limit=50` → `HighlightPageResponse(List<HighlightResponse> items, int offset, int limit)`; tartib: `matches.started_at DESC NULLS LAST, match id DESC, roundNumber, tickStart`; `limit` 1–100, `offset` 0–10000.
- `GET /api/v1/players/{playerId}/stats` → `PlayerAggregateStatsResponse(String playerId, int matches, int analyzedMatches, Double winRate, double kd, double hsPercent, Double adr, Double kast, Double entryKillsPerMatch, Double tradeKillsPerMatch, Double clutchPercent, int clutchAttempts, int clutchWins)` — bitta agregat so'rov (`JdbcClient`) o'yinchining `player_match_stats` qatorlari ustida: `matches` — qatorlar soni; `analyzedMatches` — `rounds_played IS NOT NULL`; `winRate = 100 × count(won) / count(won IS NOT NULL)` (maxraj 0 → `null`); `kd = Σkills / max(Σdeaths, 1)`; `hsPercent = 100 × Σheadshots / Σkills` (0 kill → 0); `adr` — `adr IS NOT NULL` qatorlar o'rtachasi (`null` agar yo'q); `kast = Σ(kast × rounds_played) / Σrounds_played`; `entryKillsPerMatch`/`tradeKillsPerMatch = Σ / analyzedMatches`; `clutchPercent = 100 × Σclutch_wins / Σclutch_attempts` (maxraj 0 → `null`). O'yinchi bazada yo'q → `matches = 0` va `null` lar bilan 200 (404 emas).
- `type` noto'g'ri qiymat → 400 `VALIDATION_ERROR`; `playerId` (yo'l va so'rov parametri) `PlayerController` dagi mavjud `PLAYER_ID_PATTERN` bilan tekshiriladi (konstanta kerak bo'lsa `public` qilinadi, nusxalanmaydi).
- 4-reja (Telegram bot) uchun servis metodlari: `HighlightQueryService.forMatch(String faceitMatchId, HighlightType type /*nullable*/, String faceitPlayerId /*nullable*/) -> List<HighlightResponse>`, `HighlightQueryService.forPlayer(String faceitPlayerId, HighlightType type /*nullable*/, int offset, int limit) -> HighlightPageResponse`, `StatsQueryService.aggregate(String faceitPlayerId) -> PlayerAggregateStatsResponse`.
- README'ga uchta endpoint (`curl` misollari bilan) va javob maydonlari ma'nosi.

- [ ] **Step 1:** DTO'lar, so'rov servislar, controller'lar, README.
- [ ] **Step 2: Tekshirish.** `./mvnw test` → 255 yashil. Soxta stack'da haqiqiy demo tahlilidan keyin: `GET …/matches/{id}/highlights` → Task 4 dagi qatorlar soni; `?type=ACE` va `?playerId=` filtrlari SQL sanog'iga mos; `?type=NOPE` → 400; demodagi bir o'yinchi uchun `GET …/players/{id}/highlights` va `…/stats` (o'yinchi `steam:<id>` bo'lsa yo'l parametri naqshiga tushmaydi — bu holda `players.faceit_id` ni SQL bilan vaqtincha FACEIT ko'rinishidagi id ga almashtirib yoki soxta roster SteamID'larini shu demoga moslab tekshiriladi; qaysi yo'l tanlangani hisobotda yoziladi); yig'ma qiymatlar o'sha o'yinchining yagona qatoridan qo'lda hisoblangan qiymatlarga teng; noma'lum o'yinchi → 200, `matches: 0`, `winRate: null`; `GET …/players/{id}/stats` kalitsiz ochiq. So'ng `down`.
- [ ] **Step 3: Commit** — `feat(analysis): expose highlights and aggregated player stats endpoints`

---

### Task 6: Frontend — statistika kartalari, highlight ro'yxati va demo paneli

**Files:**
- Create: `frontend/src/components/{StatsCards,HighlightList,DemoPanel}.tsx`, `frontend/src/pages/PlayerHighlightsPage.tsx`, `frontend/src/lib/adminKey.ts`
- Modify: `frontend/src/api/{types,client,queries}.ts`, `frontend/src/pages/{PlayerPage,MatchPage}.tsx`, `frontend/src/App.tsx`, mavjud testlar va `e2e/fixtures.ts`/`e2e/search-flow.spec.ts` (faqat yangi so'rovlar uchun mock javoblar), `README.md`

**Interfaces:**
- `api/types.ts`: `DemoStatus`, `DemoResponse`, `HighlightType`, `HighlightResponse`, `HighlightPageResponse`, `PlayerAggregateStatsResponse` — backend DTO'larining aynan nusxasi.
- `api/client.ts`: `apiPost<T>(path, { apiKey, body? })` — `X-API-Key` sarlavhasi bilan; `body` `FormData` bo'lishi mumkin; xatolar `apiGet` dagidek `ApiError`.
- `lib/adminKey.ts`: admin kaliti faqat xotirada (modul o'zgaruvchisi + `useAdminKey()` hook); `localStorage`/`sessionStorage`/cookie'ga yozilmaydi, sahifa yangilansa unutiladi.
- `api/queries.ts`: `useDemo(matchId)` — `GET /matches/{id}/demo`; 404 `DEMO_NOT_FOUND` xato emas, "demo yo'q" holati; holat `QUEUED`/`STORED` yoki xatosiz `PARSED` bo'lsa har 3 soniyada qayta so'raydi; `useImportDemo`, `useUploadDemo`, `useAnalyzeDemo` (mutation'lar, muvaffaqiyatda `demo` va highlight so'rovlarini yangilaydi); `useMatchHighlights(matchId)`; `usePlayerHighlights(playerId, type)` (sahifalab, mavjud `usePlayerHistory` uslubida); `usePlayerStats(playerId)`.
- `StatsCards({ stats })`: 8 karta — K/D, HS%, ADR, KAST, Entry/match, Trade/match, Clutch %, Win Rate; `null` → "—"; foizli kartalarda CSS progress chizig'i; ostida "Based on N stored matches (M with demo analysis)".
- `HighlightList({ items, showMatch })`: tur badge'i (`ACE` qizil, `CLUTCH_*` binafsha, qolganlari kulrang; `K4` → "4K", `CLUTCH_1V3` → "1v3 clutch" kabi o'qiladigan yorliq), round raqami, o'yinchi (FACEIT id bo'lsa o'yinchi sahifasiga havola, `steam:` bo'lsa oddiy matn), `showMatch` bo'lsa xarita va match havolasi; tur bo'yicha filtr (oddiy `<select>`). Bo'sh ro'yxat → "No highlights yet".
- `DemoPanel({ matchId })`: holat badge'i va `error` matni (`FAILED` da ham, tahlili yiqilgan `PARSED` da ham); "Import from FACEIT" tugmasi; `.dem` fayl tanlash + "Upload"; holat `PARSED`/`ANALYZED` bo'lsa "Re-analyze"; kalit kiritilmagan bo'lsa amal oldidan admin kaliti maydoni (`type="password"`); 401 → kalit unutiladi va "Wrong admin key" ko'rsatiladi; amal davomida tugmalar o'chirilgan.
- Sahifalar: `PlayerPage` — `StatsCards` va oxirgi 10 highlight ("All highlights" havolasi bilan); `MatchPage` — `DemoPanel` va match highlight'lari; yangi marshrut `/players/:playerId/highlights` → `PlayerHighlightsPage` (tur filtri, "Load more").
- Yangi bo'limlarning so'rovi xato bersa sahifaning qolgan qismi buzilmaydi: bo'lim ichida qisqa xato matni ko'rsatiladi. UI matnlari mavjud sahifalardagidek inglizcha.

- [ ] **Step 1:** Tiplar, klient, hook'lar, komponentlar, sahifalar, marshrut; mavjud testlar va E2E fixture'lariga faqat yangi so'rovlar uchun javoblar.
- [ ] **Step 2: Tekshirish.** `npm run lint`, `npm run build`, `npm test -- --run` (120 yashil), `npm run e2e` (1 yashil). Soxta stack'da haqiqiy demo tahlilidan keyin brauzerda (Playwright'ning bir martalik, commit qilinmaydigan skripti bilan) skrinshotlar: match sahifasi (`ANALYZED` badge'i va highlight ro'yxati), o'yinchi sahifasi (kartalar; tahlil qilinmagan o'yinchida "—"), highlight sahifasi (filtr ishlaydi); `DemoPanel` orqali noto'g'ri kalit → "Wrong admin key", to'g'ri kalit bilan "Re-analyze" → 202 va holat yangilanadi; brauzer konsolida xato yo'q. Skrinshot yo'llari hisobotda. So'ng `down`.
- [ ] **Step 3: Commit** — `feat(frontend): add stats cards, highlight lists and demo panel`

---

## O'z-o'zini tekshirish

- **Spec 4:** parser faqat fakt chiqaradi — `round_players` va `decided_tick` o'lchov; qoidalar backend'da va `POST …/demo/analyze` bilan xom faktlardan qayta hisoblanadi.
- **Spec 7:** hamma turlar (Task 4); ustunlik qoidasi (`MultiKillDetector`); clutch faqat yutilganda highlight, yutqazilgani urinish (Task 3, 4); `tick_start`/`tick_end` sozlamadan (Task 4); chegaralar `analysis.*` da (Task 2). **Og'ish:** `NINJA_DEFUSE` yaqinlik shartisiz — parser pozitsiyalarni saqlamaydi.
- **Spec 8:** K/D, HS%, ADR (Task 2), KAST, Entry, Trade, Clutch % (Task 3), Win Rate (`won` — Task 2, yig'ma — Task 5). **Aniqlashtirish:** ADR qolgan sog'liq bilan chegaralanadi; Entry — roundning birinchi raqib kill'i.
- **Spec 11:** `highlights` `V1` dagi shaklda; `highlights(player_id, type)` indeksi bor, `V3` `match_id` indekslarini, `round_players` jadvalini va `rounds.decided_tick` ni qo'shadi. **Spec 12:** qayta tahlil endpointi `X-API-Key` ostida; o'qish endpointlari ochiq. **Spec 17:** `tick_start`/`tick_end` renderer uchun tayyor; `score` ustuni qo'shilmaydi.
- **Spec'da yo'q, shu rejaning qarorlari:** ikki yangi parser fakti; tahlil xatosida `PARSED` + `error` (spec'ning "xato → `FAILED`" qoidasidan ataylab chekinish: faktlar yo'qolmaydi); tahlil qilingan qatorning asosiy ustunlarini FACEIT yozuvchisi qayta yozmasligi; `won` oxirgi round bo'yicha; `POST …/demo/analyze`; UI'da demo paneli (admin kaliti faqat xotirada); Recharts qo'shilmasligi.
- **2-reja review'idan ochiq qolgan, bu rejaga kirmaydigan:** `steam:<id>` vaqtinchalik o'yinchini keyin haqiqiy o'yinchiga qo'shib yuborish (FACEIT `game_player_id` ni doim berishi kalit bilan tekshirilgach hal qilinadi).
- **4-rejaga shartnoma:** `HighlightQueryService.forPlayer/forMatch`, `StatsQueryService.aggregate`, `HighlightResponse`, `PlayerAggregateStatsResponse` (Task 5); `round_players` (heatmap'ni round/tomon bo'yicha filtrlash uchun ham yaroqli).
