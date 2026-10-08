# 2-quyi loyiha: Demo Pipeline — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Darajasi:** spec bu quyi loyihani interfeys darajasida belgilaydi. Reja vazifalar, fayllar, interfeyslar va test nomlarini aniqlaydi; FACEIT Downloads API ruxsati (Task 0) natijasiga qarab Task 3 import worker'i o'zgarishi mumkin. Reja 1-quyi loyiha tugagach, Task 0 natijasi bilan qayta ko'rib chiqiladi.

**Goal:** `POST /api/v1/matches/{id}/demo/import` chaqirilganda demo fayl FACEIT'dan (yoki qo'lda yuklash orqali) MinIO'ga tushadi, Rust parser worker uni o'qib xom faktlarni (rounds, kills, damages, pozitsiya binlari) PostgreSQL'ga yozadi va `demos.status` `QUEUED → STORED → PARSED` bo'ylab o'tadi.

**Architecture:** Backend va parser faqat RabbitMQ (`demo.import`, `demo.parse`, `demo.parsed` navbatlari, `demo.dlq` DLQ) va umumiy saqlash (MinIO + PostgreSQL) orqali bog'lanadi. Backend'da `StorageService` interfeysi (`LocalStorage`/`MinioStorage`) va import worker; `parser/` alohida Rust crate (Tokio + lapin + demoparser2 + sqlx). Barcha consumer'lar idempotent: qayta parse `demo_id` bo'yicha oldingi xom yozuvlarni o'chirib yozadi.

**Tech Stack:** Spring AMQP, MinIO Java SDK 8, Spring Boot Testcontainers (RabbitMQ, MinIO), Flyway `V2__demo_pipeline.sql`; Rust 1.8x, Tokio, lapin, aws-sdk-s3 (MinIO S3-mos), sqlx (PostgreSQL), demoparser2, zstd; Docker Compose (`rabbitmq:4-management`, `minio/minio`).

**Spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (6, 11, 15-bo'limlar)

## Global Constraints

- Backend ↔ parser aloqasi faqat RabbitMQ + MinIO + PostgreSQL; parser backend kodiga bog'liq emas (spec 4, 16.3).
- Oqim va holatlar aynan: `QUEUED → STORED → PARSED → ANALYZED` (ANALYZED 3-quyi loyihada), xato → `FAILED` + `demos.error`.
- Navbatlar: `demo.import`, `demo.parse`, `demo.parsed`; at-least-once; 3 urinishdan so'ng `demo.dlq`.
- `demos.match_id` UNIQUE (spec: `demos.faceit_match_id UNIQUE` — bizda `matches.id` FK orqali). Qayta import mavjud yozuvni qayta ishlatadi.
- MinIO kaliti: `demos/{faceit_match_id}.dem.zst` (siqilgan) yoki `.dem`. `storage.type=local|minio`.
- Parser faqat faktlar chiqaradi: round, kill (killer, victim, weapon, headshot, wallbang, noscope, thrusmoke, attacker_blind, tick, pozitsiyalar), assist, damage, grenade, tanlangan tick pozitsiyalari. Talqin yo'q.
- Tick tezligi demo sarlavhasidan; pozitsiya har 32 tickda tanlanadi va `heat_bins` ga jamlanadi (bin o'lchami `maps.json` dan — 4-quyi loyiha; bu bosqichda `heat_bins` dunyo koordinatasida 64 birlik katakcha bilan yoziladi va 4-quyi loyihada radar'ga transformatsiya qilinadi).
- Sxema: `V2__demo_pipeline.sql` — `demos`, `rounds`, `kills`, `damages`, `heat_bins` + indekslar `kills(match_id, round_number)`, `kills(killer_id)`, `kills(victim_id)`.
- Import/upload endpointlari `X-API-Key` bilan himoyalangan (1-reja Task 7 filtri).
- Saqlash siyosati: zstd siqish; 30 kundan eski demo fayllarini tozalash job'i.

## Review Focus

1. **Demo URL 403/404 qaytaradi** (FACEIT Downloads ruxsati yo'q): `FAILED` + tushunarli `error`, cheksiz retry emas (Task 3, `forbiddenDemoUrlMarksFailedWithoutRetry`).
2. **Bir xil match uchun ikki parallel import so'rovi**: bitta `demos` qatori, bitta xabar (Task 2, `concurrentImportsCreateSingleDemoRow`).
3. **Buzilgan/yarim yuklangan `.dem`**: parser panic emas, `FAILED` + error (Task 5, `corrupt_demo_reports_error`).
4. **Qayta parse**: eski `kills/rounds/damages/heat_bins` qatorlari o'chiriladi, dublikat yo'q (Task 5, `reparse_replaces_previous_rows`).
5. **Parser DB'da `players.faceit_id` topa olmaydi** (demo'dagi SteamID ↔ FACEIT id mosligi): `kills.killer_id` uchun `players` jadvaliga `steam_id` ustuni kerak — V2 da qo'shiladi; moslik match tafsilotidagi roster'dan (`game_player_id`) yoziladi (Task 1, Task 4 `roster_maps_steam_ids_before_parse`).

---

## Fayl tuzilmasi

```
backend/src/main/java/io/csfaceit/backend/
├── demo/            # Demo entity, DemoStatus, DemoRepository, DemoService, DemoController
├── storage/         # StorageService, LocalStorage, MinioStorage, StorageProperties
├── messaging/       # RabbitConfig (exchange/queue/DLQ), DemoMessages (record'lar), DemoImportWorker, DemoParsedListener
└── resources/db/migration/V2__demo_pipeline.sql
parser/
├── Cargo.toml
├── src/main.rs          # config, lapin consumer loop
├── src/config.rs        # env: AMQP_URL, S3_*, DATABASE_URL
├── src/storage.rs       # S3 get -> local temp file, zstd decode
├── src/parse.rs         # demoparser2 -> Facts { tick_rate, rounds, kills, damages, positions }
├── src/sink.rs          # Facts -> PostgreSQL (transaction, delete-by-demo_id then insert)
├── src/bins.rs          # positions -> heat_bins (64-unit grid)
└── tests/golden.rs      # tests/fixtures/sample.dem bilan
docker-compose.yml       # + rabbitmq, minio, parser
```

---

### Task 0: FACEIT Downloads API ruxsatini tekshirish (spike, kodsiz)

- [ ] **Step 1:** Haqiqiy `FACEIT_API_KEY` bilan tugagan match uchun `GET /matches/{id}` dan `demo_url[0]` olish; `curl -I` bilan yuklab olish mumkinligini tekshirish (200 va `Content-Length`).
- [ ] **Step 2:** Natijani `docs/superpowers/specs/2026-10-08-02-demo-pipeline-notes.md` ga yozish: (a) to'g'ridan-to'g'ri ishlaydi; (b) Downloads API (`https://open.faceit.com/download/v2/demos/download`) orqali `resource_url` so'rovi kerak; (c) umuman yo'q → faqat qo'lda upload.
- [ ] **Step 3:** Task 3 import strategiyasini (a/b/c) shu natijaga ko'ra belgilash va rejadagi tegishli qatorni yangilash. Commit: `docs: record FACEIT demo download capability check`.

---

### Task 1: `V2__demo_pipeline.sql`, Demo entity va holat mashinasi

**Files:**
- Create: `backend/src/main/resources/db/migration/V2__demo_pipeline.sql`
- Create: `backend/src/main/java/io/csfaceit/backend/demo/Demo.java`, `DemoStatus.java`, `DemoRepository.java`
- Test: `backend/src/test/java/io/csfaceit/backend/demo/DemoRepositoryTest.java`

**Interfaces:**
- `V2`: `ALTER TABLE players ADD COLUMN steam_id VARCHAR(32)` + `UNIQUE INDEX` (nullable); `demos(id, match_id UNIQUE FK matches, status VARCHAR(16), storage_key, error TEXT, tick_rate INTEGER, created_at, updated_at)`; `rounds(..., UNIQUE(match_id, round_number))`; `kills(... + attacker_blind BOOLEAN)`; `damages(...)`; `heat_bins(match_id, player_id, kind VARCHAR(16), side VARCHAR(2), bin_x INT, bin_y INT, count INT, PRIMARY KEY(match_id, player_id, kind, side, bin_x, bin_y))`; indekslar spec 11.
- `enum DemoStatus { QUEUED, STORED, PARSED, ANALYZED, FAILED }`; `Demo { Long id; Match match; DemoStatus status; String storageKey; String error; Integer tickRate; ... }`; `DemoRepository.findByMatchId(Long)`.
- `Demo.transitionTo(DemoStatus next)` — ruxsat etilgan o'tishlar: QUEUED→STORED, STORED→PARSED, PARSED→ANALYZED, har qanday→FAILED, FAILED→QUEUED (qayta urinish). Boshqasi → `IllegalStateException`.

- [ ] Step 1: Testlar: `migrationCreatesPipelineTables`, `illegalTransitionThrows` (PARSED→STORED), `failedCanBeRequeued`.
- [ ] Step 2: Tushishini tekshirish (`./mvnw -q test -Dtest=DemoRepositoryTest`).
- [ ] Step 3: SQL, entity, enum yozish.
- [ ] Step 4: O'tishini tekshirish. Step 5: Commit `feat(demo): add pipeline schema and Demo status machine`.

---

### Task 2: RabbitMQ konfiguratsiyasi va import endpoint'i

**Files:**
- Create: `messaging/RabbitConfig.java`, `messaging/DemoMessages.java`
- Create: `demo/DemoService.java`, `demo/DemoController.java`, `demo/dto/DemoResponse.java`
- Test: `demo/DemoControllerTest.java` (Testcontainers `rabbitmq:4-management`)

**Interfaces:**
- `RabbitConfig`: `TopicExchange demo` (nomi `demo`), DLX `demo.dlx`; queue'lar `demo.import`, `demo.parse`, `demo.parsed` (`x-dead-letter-exchange=demo.dlx`), `demo.dlq`. Jackson message converter. Listener container: `defaultRequeueRejected=false`, retry interceptor `maxAttempts=3`, backoff 1 s × 2.
- `DemoMessages`: `record DemoImportRequested(long demoId, String faceitMatchId, String demoUrl)`, `record DemoStored(long demoId, String faceitMatchId, String storageKey)`, `record DemoParsed(long demoId, String faceitMatchId)`.
- `DemoService.requestImport(String faceitMatchId) -> DemoResponse`: `MatchService.getMatch` (match va demoUrl olish), `demos` qatorini topish-yoki-yaratish (`@Transactional`, `SELECT ... FOR UPDATE` yoki UNIQUE ushlash), holat `QUEUED`/`FAILED` bo'lsa `demo.import` ga xabar yuboradi; `STORED+` bo'lsa xabarsiz mavjud holatni qaytaradi. `DemoService.get(String faceitMatchId) -> DemoResponse`.
- HTTP: `POST /api/v1/matches/{matchId}/demo/import` → 202 `DemoResponse(demoId, matchId, status, error, updatedAt)`; `GET /api/v1/matches/{matchId}/demo` → 200/404 `DEMO_NOT_FOUND`.

- [ ] Step 1: Testlar — `importRequiresApiKey` (401), `importCreatesQueuedDemoAndPublishesMessage` (RabbitTemplate bilan `demo.import` dan xabar o'qiladi), `repeatedImportReusesRow`, `concurrentImportsCreateSingleDemoRow` (10 parallel so'rov → 1 qator, ≤ 1 xabar), `getDemoReturnsStatus`.
- [ ] Step 2–5: TDD sikli; Commit `feat(demo): add RabbitMQ topology and demo import endpoint`.

---

### Task 3: `StorageService` va import worker

**Files:**
- Create: `storage/StorageService.java`, `LocalStorage.java`, `MinioStorage.java`, `StorageProperties.java`, `StorageConfig.java`
- Create: `messaging/DemoImportWorker.java`
- Test: `storage/LocalStorageTest.java`, `storage/MinioStorageTest.java` (Testcontainers `minio/minio`), `messaging/DemoImportWorkerTest.java` (WireMock demo URL)

**Interfaces:**
- `interface StorageService { String put(String key, InputStream data, long size, String contentType); InputStream get(String key); boolean exists(String key); void delete(String key); List<String> listOlderThan(String prefix, Instant cutoff); }`
- `StorageProperties(String type, String localDir, Minio minio)`; `Minio(String endpoint, String accessKey, String secretKey, String bucket)`; bucket `demos` yo'q bo'lsa start'da yaratiladi.
- `DemoImportWorker` (`@RabbitListener(queues="demo.import")`): URL'dan oqim bilan yuklaydi (RestClient, 60 s read timeout), `.gz` bo'lsa ochib `zstd` bilan qayta siqadi (`demos/{faceit_match_id}.dem.zst`), `StorageService.put`, `demos.status=STORED, storage_key`, `demo.parse` ga `DemoStored` yuboradi. 403/404 → `FAILED` + error, `AmqpRejectAndDontRequeueException` (retry yo'q). 5xx/IO → istisno (retry → DLQ).
- Task 0 natijasi (b) bo'lsa: yuklashdan oldin Downloads API orqali imzolangan URL olinadi — `FaceitGateway.resolveDemoDownloadUrl(String resourceUrl)` qo'shiladi.

- [ ] Step 1: Testlar — `localStoragePutGetRoundTrip`, `minioStoragePutGetRoundTrip`, `importStoresZstdAndMarksStored` (WireMock 200 + 1 MB fayl → MinIO'da kalit bor, status STORED, `demo.parse` xabari), `forbiddenDemoUrlMarksFailedWithoutRetry` (403 → FAILED, WireMock 1 so'rov), `serverErrorGoesToDlqAfterThreeAttempts` (3x 503 → `demo.dlq` da xabar, status FAILED).
- [ ] Step 2–5: TDD sikli; Commit `feat(demo): add storage abstraction and demo import worker`.

---

### Task 4: Qo'lda `.dem` yuklash va SteamID moslashtirish

**Files:**
- Modify: `demo/DemoController.java`, `demo/DemoService.java`
- Create: `demo/RosterSteamIdMapper.java`
- Test: `demo/DemoUploadTest.java`

**Interfaces:**
- HTTP: `POST /api/v1/matches/{matchId}/demo/upload` (multipart `file`, maks `spring.servlet.multipart.max-file-size=1GB`, `X-API-Key`) → faylni `StorageService.put` (zstd), `demos` upsert `STORED`, `demo.parse` xabari. Kengaytma `.dem` yoki `.dem.gz`/`.dem.zst` emas → 400 `VALIDATION_ERROR`.
- `RosterSteamIdMapper.mapRoster(FaceitMatch)`: FACEIT roster'dagi `game_player_id` (SteamID64) → `players.steam_id` yoziladi (`FaceitRosterPlayer` ga `gamePlayerId` maydoni qo'shiladi). Import va upload oldidan chaqiriladi, shunda parser `steam_id` bo'yicha `players.id` topa oladi.

- [ ] Step 1: Testlar — `uploadStoresFileAndPublishesParse`, `uploadRejectsNonDemoExtension`, `roster_maps_steam_ids_before_parse` (upsert'dan keyin 10 o'yinchida `steam_id` to'ldirilgan).
- [ ] Step 2–5: TDD sikli; Commit `feat(demo): add manual demo upload and roster SteamID mapping`.

---

### Task 5: Rust parser worker

**Files:**
- Create: `parser/Cargo.toml`, `parser/src/{main,config,storage,parse,sink,bins}.rs`, `parser/tests/golden.rs`, `parser/tests/fixtures/sample.dem` (qisqa, ≤ 20 MB, Git LFS yoki `tests/fixtures/README.md` dagi yuklab olish buyrug'i), `parser/Dockerfile`

**Interfaces:**
- Xabar formati Task 2 `DemoStored` JSON'iga mos: `{ "demoId": 1, "faceitMatchId": "...", "storageKey": "demos/....dem.zst" }`. Natija: `demo.parsed` ga `{ "demoId", "faceitMatchId" }`.
- `parse::parse_demo(path: &Path) -> Result<Facts, ParseError>`; `struct Facts { tick_rate: u32, rounds: Vec<Round>, kills: Vec<Kill>, damages: Vec<Damage>, positions: Vec<Position> }`. `Kill { round_number, tick, killer_steam_id, victim_steam_id, weapon, headshot, wallbang, noscope, thrusmoke, attacker_blind, killer_x, killer_y, victim_x, victim_y }`. `Round { round_number, winner_side: "CT"|"T", win_reason, start_tick, end_tick }`. `Position { tick, steam_id, side, x, y }` har 32 tickda.
- `bins::aggregate(positions, kills) -> Vec<HeatBin>` — `kind ∈ {kill, death, movement}`, `bin_x = floor(x / 64)`, `bin_y = floor(y / 64)`.
- `sink::write(pool, demo_id, match_id, facts)` — bitta tranzaksiya: `DELETE ... WHERE match_id=$1` (rounds, kills, damages, heat_bins), `INSERT` (batch), `UPDATE demos SET status='PARSED', tick_rate=$2`. `steam_id → players.id` mapping `SELECT id, steam_id FROM players WHERE steam_id = ANY($1)` bilan; topilmasa `players` ga `faceit_id = 'steam:' || steam_id` bilan yangi qator (keyin FACEIT upsert bilan birlashtiriladi).
- Xato: har qanday `Err` → `UPDATE demos SET status='FAILED', error=$1`, xabar `nack(requeue=false)` (DLQ).

- [ ] Step 1: Golden test — `sample_demo_has_expected_counts`: `rounds.len()`, `kills.len()`, `tick_rate` fixture README'da yozilgan qiymatlarga teng; `kills` da hech bo'lmaganda bitta `headshot=true`. `corrupt_demo_reports_error`: 1 KB tasodifiy fayl → `Err`, panic yo'q. `bins_group_positions_into_64_unit_cells`.
- [ ] Step 2: `cargo test` — FAIL (kompilyatsiya).
- [ ] Step 3: Implementatsiya; `main.rs`: lapin consumer `demo.parse` (prefetch 1), S3 dan temp faylga yuklash, zstd decode, parse, sink, publish, ack.
- [ ] Step 4: `cargo test` PASS; `cargo clippy -- -D warnings` toza.
- [ ] Step 5: Integratsiya testi (`tests/e2e.rs`, `#[ignore]`, Compose bilan): `reparse_replaces_previous_rows` — bir xil xabar 2 marta → `kills` soni bir xil.
- [ ] Step 6: Commit `feat(parser): add Rust demo parser worker writing raw facts to PostgreSQL`.

---

### Task 6: `demo.parsed` listener, tozalash job'i, Compose va kuzatuvchanlik

**Files:**
- Create: `messaging/DemoParsedListener.java` (hozircha log + `ANALYZED` o'tishini 3-quyi loyiha qo'shadi; bu bosqichda status `PARSED` da qoladi, listener faqat metrikani yangilaydi)
- Create: `demo/DemoRetentionJob.java` (`@Scheduled(cron="0 0 4 * * *")`, `storage.retention-days=30`): `StorageService.listOlderThan` → `delete`, `demos.storage_key=null`, status o'zgarmaydi (xom faktlar DB'da qoladi).
- Modify: `docker-compose.yml` — `rabbitmq:4-management` (5672, 15672), `minio/minio` (9000, 9001, `mc` bilan bucket yaratish init), `parser` (`build: ./parser`, env `AMQP_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, DATABASE_URL`), `prometheus`, `grafana`, `loki` + `promtail` (spec 13). `.env.example` yangi kalitlar.
- Metrikalar: `demo.pipeline.stage.duration` (tag `stage=import|parse`), `demo.queue.depth` (RabbitMQ management API yoki `rabbitmq_prometheus` plugin), `demo.dlq.messages`.

- [ ] Step 1: Testlar — `retentionDeletesObjectsOlderThan30Days` (LocalStorage, fayl `mtime` eski), `retentionKeepsRecentObjects`.
- [ ] Step 2–4: TDD sikli.
- [ ] Step 5: End-to-end tekshirish: `docker compose up -d --build`, `curl -X POST -H "X-API-Key: ..." localhost:3000/api/v1/matches/{id}/demo/import` → `GET .../demo` 1–3 daqiqada `PARSED`; `SELECT count(*) FROM kills WHERE match_id=...` > 0.
- [ ] Step 6: Commit `feat(demo): add retention job, parsed listener and full pipeline compose stack`.

---

## O'z-o'zini tekshirish

- Spec 6-bo'lim oqimi: import endpoint (T2), import worker (T3), parser (T5), `demo.parsed` (T6; `ANALYZED` 3-rejada). Saqlash interfeysi va `storage.type` (T3). Idempotentlik (T2, T5). DLQ/FAILED (T2, T3, T5). Faktlar ro'yxati va tick tezligi (T5). Pozitsiya tanlab olish va binlar (T5). Zaxira upload (T4). Zstd va 30 kunlik tozalash (T3, T6). Sxema/indekslar (T1).
- Ochiq nuqta: `heat_bins` bu rejada dunyo koordinatasida; radar transformatsiyasi 4-rejada `maps.json` bilan. Grenade va assist faktlari parserdan chiqariladi, lekin jadval 3-rejada (`assists`, `grenades`) qo'shiladi — T5 `Facts` strukturasida maydon qoldiriladi, sink hozircha yozmaydi.
