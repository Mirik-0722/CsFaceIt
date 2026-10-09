# 2-quyi loyiha: Demo Pipeline — Implementatsiya Rejasi (2026-10-09 qayta ko'rilgan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Bu tahrir nimani o'zgartirdi:** (1) foydalanuvchi qaroriga ko'ra **yangi test yozilmaydi** — har vazifa mavjud test to'plamini bir marta ishga tushirish va aniq smoke-tekshiruv bilan tugaydi; (2) mashinada haqiqiy FACEIT kaliti yo'q, shuning uchun eski "Task 0" (Downloads API ruxsatini tekshirish) o'rniga lokal **soxta FACEIT** (WireMock) qo'shildi; (3) 1-rejaning haqiqiy kodi (`FaceitGateway`, `MatchService`/`MatchPersistence`, `SecurityConfig`) asos qilib olindi; (4) 3-reja kutgan ustunlar (bomb tick'lari, side'lar, assister) shu rejaning V2 migratsiyasiga kiritildi.

**Goal:** `POST /api/v1/matches/{matchId}/demo/import` (yoki qo'lda upload) chaqirilganda demo fayl saqlanadi, Rust parser worker uni o'qib xom faktlarni (rounds, kills, damages, heat_bins) PostgreSQL'ga yozadi va `demos.status` `QUEUED → STORED → PARSED` bo'ylab o'tadi; xato bo'lsa `FAILED` va sabab matni saqlanadi.

**Architecture:** Backend va parser faqat RabbitMQ (`demo` exchange; `demo.import`, `demo.parse`, `demo.parsed` navbatlari; `demo.dlq`) va umumiy saqlash (S3-mos MinIO + PostgreSQL) orqali bog'lanadi. Backend'da `StorageService` (`LocalStorage`/`MinioStorage`), import worker va `demos` holat mashinasi; `parser/` — alohida Rust binari (Tokio, lapin, aws-sdk-s3, sqlx, demoparser). Topologiyani backend e'lon qiladi; parser mavjud navbatdan iste'mol qiladi. Barcha iste'molchilar idempotent.

**Tech Stack:** Spring AMQP, MinIO Java SDK, zstd-jni, Flyway `V2__demo_pipeline.sql`; Rust (Tokio, lapin, aws-sdk-s3, sqlx, zstd, LaihoE/demoparser); Docker Compose (`rabbitmq:4-management`, `minio/minio`, `wiremock/wiremock`, `prom/prometheus`, `grafana/grafana`).

**Spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (6, 11, 12, 13, 15-bo'limlar)

## Global Constraints

- **Yangi test yozilmaydi** (foydalanuvchi qarori, 2026-10-09). Mavjud backend testlari (255) va frontend testlari yashil qolishi shart; ularni yashil saqlash uchun kerak bo'lsa mavjud test infratuzilmasiga eng kichik tahrir kiritiladi. Har vazifa o'zining "Tekshirish" qadamidagi buyruqlar bilan tasdiqlanadi.
- Backend ↔ parser aloqasi faqat RabbitMQ + MinIO + PostgreSQL; parser backend kodiga bog'liq emas (spec 4, 16.3).
- Holatlar aynan: `QUEUED → STORED → PARSED → ANALYZED` (`ANALYZED` 3-rejada), xato → `FAILED` + `demos.error`. Ruxsat etilgan o'tishlar: QUEUED→STORED, STORED→PARSED, PARSED→ANALYZED, har qanday→FAILED, FAILED→QUEUED, FAILED→STORED (qo'lda upload).
- RabbitMQ: topic exchange `demo` (durable); navbatlar `demo.import`, `demo.parse`, `demo.parsed` (durable, routing key = navbat nomi, `x-dead-letter-exchange=demo.dlx`); fanout `demo.dlx` → `demo.dlq`. At-least-once; 3 urinishdan so'ng DLQ.
- Xabarlar JSON, maydonlar camelCase (Java va Rust uchun yagona shartnoma):
  - `demo.import`: `{"demoId": 1, "faceitMatchId": "1-…", "demoUrl": "https://…"}`
  - `demo.parse`: `{"demoId": 1, "faceitMatchId": "1-…", "storageKey": "demos/1-….dem.zst"}`
  - `demo.parsed`: `{"demoId": 1, "faceitMatchId": "1-…"}`
- Saqlash kaliti: `demos/{faceit_match_id}.dem.zst` (har doim zstd). `storage.type=local|minio` (default `local`).
- Parser faqat faktlar chiqaradi (round, kill, damage, pozitsiya binlari); talqin (highlight, statistika) yo'q.
- Tick tezligi demo sarlavhasidan (topilmasa 64); pozitsiya har 32 tickda tanlanadi; `heat_bins` dunyo koordinatasida 64 birlik katakcha (`bin = floor(coord / 64)`).
- Import/upload endpointlari `X-API-Key` talab qiladi — `SecurityConfig` buni GET/HEAD bo'lmagan har so'rov uchun allaqachon ta'minlaydi; yangi GET endpointlar ochiq.
- `matchId` yo'l o'zgaruvchisi 1-rejadagidek `^[A-Za-z0-9-]{1,64}$` bilan tekshiriladi; xato modeli — mavjud `ApiError`/`NotFoundException`/`ApiExceptionHandler`.
- Sirlar faqat muhit o'zgaruvchilaridan; repoda `.env` yo'q. Dev default'lar (`guest`/`minioadmin`) faqat loopback'da nashr etilgan konteynerlar uchun.
- Hujjat tili o'zbekcha; kod identifikatorlari, commit va log matnlari inglizcha.

## Review Focus

Testlar yozilmagani uchun quyidagilar review'da kodni o'qib tekshiriladi va har biri egasi vazifaning smoke qadamida sinab ko'riladi.

1. **Demo URL 403/404 qaytaradi** (FACEIT Downloads ruxsati yo'q): `FAILED` + tushunarli `error`, qayta urinishsiz (Task 3).
2. **Bir match uchun parallel import so'rovlari**: bitta `demos` qatori, ortiqcha xabar yo'q (Task 2).
3. **Buzilgan `.dem`**: parser panic qilmaydi, `FAILED` + error, xabar DLQ'ga (Task 5).
4. **Qayta parse**: match bo'yicha eski `rounds/kills/damages/heat_bins` o'chirilib yoziladi, dublikat yo'q (Task 5).
5. **Demo'dagi SteamID `players` da yo'q**: parser `faceit_id='steam:<id>'` bilan qator yaratadi, kill'lar yo'qolmaydi (Task 4, Task 5).

---

## Fayl tuzilmasi

```
dev/fake-faceit/                    # WireMock mappings + __files (soxta FACEIT)
docker-compose.fake.yml             # fake-faceit servisi + backend'ni unga yo'naltirish
backend/src/main/java/io/csfaceit/backend/
├── demo/        Demo, DemoStatus, DemoRepository, DemoPersistence, DemoService, DemoController, dto/DemoResponse,
│                RosterSteamIdMapper, DemoRetentionJob
├── storage/     StorageService, LocalStorage, MinioStorage, StorageProperties, StorageConfig
└── messaging/   RabbitConfig, DemoMessages, DemoImportWorker, DemoDlqListener, DemoParsedListener
backend/src/main/resources/db/migration/V2__demo_pipeline.sql
parser/          Cargo.toml, Dockerfile, src/{main,config,messages,storage,parse,bins,sink}.rs
ops/prometheus/prometheus.yml, ops/grafana/provisioning/datasources/prometheus.yml
```

---

### Task 1: Soxta FACEIT (WireMock) bilan lokal stack

**Files:**
- Create: `dev/fake-faceit/mappings/*.json`, `dev/fake-faceit/__files/demos/sample.dem`, `dev/fake-faceit/README.md`
- Create: `docker-compose.fake.yml`
- Modify: `README.md` (qisqa bo'lim)

**Interfaces:**
- Produces: `docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait` — haqiqiy kalitsiz ishlaydigan to'liq stack. Keyingi barcha vazifalar smoke-tekshiruvni shu bilan qiladi.
- `fake-faceit` servisi: `wiremock/wiremock` (3.x, aniq teg), port 8080 (hostga `127.0.0.1:8089`), `./dev/fake-faceit:/home/wiremock:ro`.
- Override `backend` uchun: `FACEIT_BASE_URL=http://fake-faceit:8080`, `FACEIT_API_KEY=fake`, `APP_API_KEY=${APP_API_KEY:-dev-admin-key}`.
- Mapping'lar (qiymatlar `backend/src/test/resources/faceit/*.json` fixture'laridan olinadi, shakli aynan o'sha): `GET /players?nickname=s1mple`, `GET /players/11111111-1111-1111-1111-111111111111`, `GET /players/{shu id}/history` (har qanday query), `GET /matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, `GET /matches/{shu id}/stats`; noma'lum nickname/id → 404 (FACEIT xato tanasi shaklida). Match javobida `demo_url = ["http://fake-faceit:8080/demos/sample.dem"]` va har roster o'yinchisida `game_player_id` (17 xonali SteamID64, masalan `76561198000000001` … `…010`).
- `GET /demos/sample.dem` → `__files/demos/sample.dem` (repoda ~1 KB li soxta fayl: bu haqiqiy demo emas; parser smoke'i uchun shu fayl lokal ravishda haqiqiy `.dem` bilan almashtiriladi va commit qilinmaydi — `dev/fake-faceit/README.md` shuni tushuntiradi). `GET /demos/missing.dem` → 404, `GET /demos/forbidden.dem` → 403 (xato yo'llarini sinash uchun).

- [ ] **Step 1:** Mapping'lar, soxta fayl, `docker-compose.fake.yml`, README'larni yozish.
- [ ] **Step 2: Tekshirish.** Stack'ni yuqoridagi buyruq bilan ko'tarish; `curl -s localhost:3000/api/v1/players?nickname=s1mple` → 200 va `"elo":3500`; `…/players/<id>/history` → 2 ta element; `…/matches/<id>` → `"mapName":"de_mirage"`; `…/matches/<id>/stats` → 10 o'yinchi; `…/players?nickname=nobody` → 404 `PLAYER_NOT_FOUND`. So'ng `docker compose -f … -f … down`.
- [ ] **Step 3: Commit** — `build(dev): add WireMock fake FACEIT stack for keyless local runs`

---

### Task 2: V2 sxema, `Demo` domeni, RabbitMQ topologiyasi, import/status API

**Files:**
- Create: `backend/src/main/resources/db/migration/V2__demo_pipeline.sql`
- Create: `demo/Demo.java`, `DemoStatus.java`, `DemoRepository.java`, `DemoPersistence.java`, `DemoService.java`, `DemoController.java`, `demo/dto/DemoResponse.java`
- Create: `messaging/RabbitConfig.java`, `messaging/DemoMessages.java`
- Modify: `backend/pom.xml` (`spring-boot-starter-amqp`), `application.yml` (`spring.rabbitmq.*`), `player/Player.java` (`steamId`), `faceit/dto/FaceitRosterPlayer.java` (`gamePlayerId`), `AbstractIntegrationTest.java` (broker'siz yashil qolishi uchun xossalar), `docker-compose.yml` (`rabbitmq` servisi, backend env), `.env.example`

**Interfaces:**
- `V2__demo_pipeline.sql` (aynan):
  - `ALTER TABLE players ADD COLUMN steam_id VARCHAR(32);` + `CREATE UNIQUE INDEX uq_players_steam_id ON players (steam_id) WHERE steam_id IS NOT NULL;`
  - `demos(id BIGSERIAL PK, match_id BIGINT NOT NULL UNIQUE REFERENCES matches(id), status VARCHAR(16) NOT NULL, storage_key VARCHAR(255), error TEXT, tick_rate INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  - `rounds(id BIGSERIAL PK, match_id BIGINT NOT NULL REFERENCES matches(id), round_number INTEGER NOT NULL, winner_side VARCHAR(2), win_reason VARCHAR(32), start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL, bomb_planted_tick INTEGER, bomb_defused_tick INTEGER, defuser_id BIGINT REFERENCES players(id), UNIQUE (match_id, round_number))`
  - `kills(id BIGSERIAL PK, match_id BIGINT NOT NULL REFERENCES matches(id), round_number INTEGER NOT NULL, tick INTEGER NOT NULL, killer_id BIGINT REFERENCES players(id), victim_id BIGINT NOT NULL REFERENCES players(id), assister_id BIGINT REFERENCES players(id), weapon VARCHAR(64) NOT NULL, headshot/wallbang/noscope/thrusmoke/attacker_blind BOOLEAN NOT NULL DEFAULT false, killer_side VARCHAR(2), victim_side VARCHAR(2), killer_x REAL, killer_y REAL, victim_x REAL, victim_y REAL)` — `killer_id` NULL: dunyo/bomba o'limi
  - `damages(id BIGSERIAL PK, match_id BIGINT NOT NULL REFERENCES matches(id), round_number INTEGER NOT NULL, tick INTEGER NOT NULL, attacker_id BIGINT REFERENCES players(id), victim_id BIGINT NOT NULL REFERENCES players(id), weapon VARCHAR(64), damage_health INTEGER NOT NULL, damage_armor INTEGER NOT NULL DEFAULT 0)`
  - `heat_bins(match_id BIGINT NOT NULL REFERENCES matches(id), player_id BIGINT NOT NULL REFERENCES players(id), kind VARCHAR(16) NOT NULL, side VARCHAR(2) NOT NULL, bin_x INTEGER NOT NULL, bin_y INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (match_id, player_id, kind, side, bin_x, bin_y))` — `kind ∈ kill|death|movement`, `side ∈ CT|T`
  - Indekslar: `kills(match_id, round_number)`, `kills(killer_id)`, `kills(victim_id)`, `damages(match_id, round_number)`.
  - JPA entity faqat `Demo` uchun (xom jadvallarni parser yozadi; ularning entity'lari 3-rejada).
- `enum DemoStatus { QUEUED, STORED, PARSED, ANALYZED, FAILED }`; `Demo { Long id; Match match; DemoStatus status; String storageKey; String error; Integer tickRate; Instant createdAt, updatedAt }`; `void transitionTo(DemoStatus next)` — Global Constraints'dagi o'tishlar, boshqasi `IllegalStateException`; `void fail(String error)`; `DemoRepository.findByMatchId(Long)`, `findByMatchFaceitMatchId(String)`.
- `DemoMessages`: `record DemoImportRequested(long demoId, String faceitMatchId, String demoUrl)`, `record DemoStored(long demoId, String faceitMatchId, String storageKey)`, `record DemoParsed(long demoId, String faceitMatchId)`; konstantalar `EXCHANGE="demo"`, `Q_IMPORT`, `Q_PARSE`, `Q_PARSED`, `DLX="demo.dlx"`, `DLQ="demo.dlq"`.
- `RabbitConfig`: yuqoridagi topologiya (`Declarables`), `Jackson2JsonMessageConverter`, listener factory: `defaultRequeueRejected=false`, stateless retry (3 urinish, 1 s, ×2) + `RepublishMessageRecoverer` → `demo.dlx` (istisno matni sarlavhada).
- `DemoPersistence` (`@Transactional` bean, `MatchPersistence` uslubida): `Demo queue(long matchRowId)` — topadi yoki `QUEUED` yaratadi; `FAILED` bo'lsa `QUEUED` ga qaytaradi; natijada xabar yuborish kerakmi-yo'qmi qaytariladi.
- `DemoService` (tranzaksiyasiz, `MatchService` uslubida): `DemoResponse requestImport(String faceitMatchId)` — `MatchService.getMatch` (match saqlanadi) → `FaceitGateway.getMatch` dan `demoUrl` (keshdan) → `demoUrl` yo'q bo'lsa 409 `DEMO_URL_UNAVAILABLE` → `DemoPersistence.queue` (unique to'qnashuvda bir marta qayta urinish) → **commit'dan keyin** kerak bo'lsa `demo.import` ga xabar. `STORED`/`PARSED`/`ANALYZED` holatda xabarsiz mavjud holat qaytadi. `DemoResponse get(String faceitMatchId)` → yo'q bo'lsa 404 `DEMO_NOT_FOUND`.
- `record DemoResponse(long demoId, String matchId, DemoStatus status, String error, Instant updatedAt)` (`matchId` — FACEIT match id).
- HTTP: `POST /api/v1/matches/{matchId}/demo/import` → 202; `GET /api/v1/matches/{matchId}/demo` → 200.
- `application.yml`: `spring.rabbitmq.host/port/username/password` ← `RABBITMQ_HOST:localhost`, `RABBITMQ_PORT:5672`, `RABBITMQ_USER:guest`, `RABBITMQ_PASSWORD:guest`.
- Mavjud testlar broker'siz ishlashi uchun `AbstractIntegrationTest` `@DynamicPropertySource` ga: `spring.rabbitmq.listener.simple.auto-startup=false`, `management.health.rabbit.enabled=false`.
- Compose: `rabbitmq` (`rabbitmq:4-management`, `127.0.0.1:5672`, `127.0.0.1:15672`, healthcheck `rabbitmq-diagnostics -q ping`); backend `depends_on` + `RABBITMQ_HOST=rabbitmq`.

- [ ] **Step 1:** Migratsiya, domen, konfiguratsiya, servis, controller, compose.
- [ ] **Step 2: Tekshirish.** `./mvnw test` → mavjud 255 test yashil. Soxta stack bilan: `curl -X POST -H "X-API-Key: dev-admin-key" localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/import` → 202 `"status":"QUEUED"`; kalitsiz → 401; `GET …/demo` → 200; noma'lum match → 404; 10 ta parallel POST → `demos` da 1 qator va `demo.import` navbatida 1 xabar (RabbitMQ management API yoki `rabbitmqctl list_queues`).
- [ ] **Step 3: Commit** — `feat(demo): add pipeline schema, RabbitMQ topology and demo import endpoint`

---

### Task 3: `StorageService`, import worker, DLQ → `FAILED`

**Files:**
- Create: `storage/StorageService.java`, `LocalStorage.java`, `MinioStorage.java`, `StorageProperties.java`, `StorageConfig.java`
- Create: `messaging/DemoImportWorker.java`, `messaging/DemoDlqListener.java`, `demo/DemoDownloader.java`
- Modify: `backend/pom.xml` (`io.minio:minio`, `com.github.luben:zstd-jni`), `application.yml` (`storage.*`, `demo.download.*`), `demo/DemoPersistence.java`, `docker-compose.yml` (`minio` servisi + volume, backend env), `.env.example`

**Interfaces:**
- `interface StorageService { void put(String key, Path file); InputStream get(String key); boolean exists(String key); void delete(String key); List<String> listOlderThan(String prefix, Instant cutoff); }`
- `StorageProperties(String type, String localDir, Minio minio)`; `Minio(String endpoint, String accessKey, String secretKey, String bucket)` ← `STORAGE_TYPE:local`, `STORAGE_LOCAL_DIR:./data/storage`, `MINIO_ENDPOINT:http://localhost:9000`, `MINIO_ACCESS_KEY:minioadmin`, `MINIO_SECRET_KEY:minioadmin`, `MINIO_BUCKET:csfaceit`. `StorageConfig` `storage.type` bo'yicha bitta bean beradi; `MinioStorage` start'da bucket yo'q bo'lsa yaratadi; `LocalStorage` kalitdagi `..` ni rad etadi.
- `DemoDownloader.download(String url) -> Path` — faqat `http`/`https`; oqim bilan vaqtinchalik faylga; `demo.download.connect-timeout=5s`, `read-timeout=120s`, `max-size=1GB` (oshsa xato); HTTP 401/403/404/410 → `DemoDownloadRejectedException` (qayta urinilmaydi), boshqa xato → qayta uriniladigan istisno. Natija **zstd'ga normallashtiriladi**: gzip (`1f 8b`) → ochib zstd; zstd (`28 b5 2f fd`) → o'zgarishsiz; aks holda xom → zstd.
- `DemoImportWorker` (`@RabbitListener(queues="demo.import")`): demo `QUEUED` bo'lmasa — hech narsa qilmaydi (idempotent); yuklaydi → `storage.put("demos/{faceitMatchId}.dem.zst")` → `STORED` + `storage_key` → commit'dan keyin `demo.parse` ga `DemoStored`. `DemoDownloadRejectedException` → `FAILED` + `error` (`Demo download rejected: HTTP 403. FACEIT Downloads API access may be required; upload the .dem manually.`) va `AmqpRejectAndDontRequeueException`. Vaqtinchalik fayl har holatda o'chiriladi.
- `DemoDlqListener` (`@RabbitListener(queues="demo.dlq")`): xabardagi `demoId` bo'yicha demo terminal bo'lmasa `FAILED` qiladi; `error` — `x-exception-message` sarlavhasi yoki `Processing failed after 3 attempts`. Allaqachon `FAILED` bo'lsa `error` ni saqlab qoladi.
- Compose: `minio` (`minio/minio`, `server /data --console-address :9001`, `127.0.0.1:9000`, `127.0.0.1:9001`, volume `miniodata`, healthcheck); backend: `STORAGE_TYPE=minio`, `MINIO_ENDPOINT=http://minio:9000`, `MINIO_*`.

- [ ] **Step 1:** Storage, downloader, worker, DLQ listener, compose.
- [ ] **Step 2: Tekshirish.** `./mvnw test` yashil. Soxta stack bilan: import → bir necha soniyada `GET …/demo` `"status":"STORED"`; MinIO'da `demos/<id>.dem.zst` obyekti bor va zstd sehrli baytlari bilan boshlanadi; `demo.parse` navbatida 1 xabar. Soxta match `demo_url` ini vaqtincha `…/demos/forbidden.dem` ga yo'naltirib (alohida mapping/match id): `FAILED` + yuqoridagi matn, soxta serverga aynan 1 so'rov. `…/demos/missing.dem` → `FAILED`.
- [ ] **Step 3: Commit** — `feat(demo): add storage abstraction, import worker and dead-letter handling`

---

### Task 4: Qo'lda `.dem` yuklash va SteamID moslashtirish

**Files:**
- Create: `demo/RosterSteamIdMapper.java`
- Modify: `demo/DemoController.java`, `demo/DemoService.java`, `demo/DemoPersistence.java`, `player/PlayerService.java`, `application.yml` (`spring.servlet.multipart.max-file-size=1GB`, `max-request-size=1GB`), `frontend/nginx.conf` (`client_max_body_size 1g;` `/api/` uchun, `proxy_request_buffering off;`)

**Interfaces:**
- `POST /api/v1/matches/{matchId}/demo/upload` (multipart `file`) → 202 `DemoResponse`. Fayl nomi `.dem`, `.dem.gz` yoki `.dem.zst` bilan tugamasa → 400 `VALIDATION_ERROR`. Fayl Task 3 dagi normallashtirish orqali zstd'ga keltirilib saqlanadi; `demos` qatori `STORED` (yo'q bo'lsa yaratiladi; `QUEUED`/`FAILED` dan o'tadi; `PARSED`/`ANALYZED` bo'lsa ham qayta `STORED` — qo'lda upload ataylab qayta parse qiladi, shu o'tishlar holat mashinasiga qo'shiladi); `demo.parse` xabari. Match FACEIT'da topilmasa 404 `MATCH_NOT_FOUND`.
- `RosterSteamIdMapper.apply(FaceitMatch match)` — har roster o'yinchisi uchun `PlayerService.ensurePlayer(playerId, nickname)` va `gamePlayerId` bo'sh bo'lmasa `players.steam_id` ni o'rnatadi (boshqa qatorda shu SteamID bo'lsa — o'sha `steam:<id>` vaqtinchalik qatori bo'lsa, uning `steam_id` si tozalanadi va WARN yoziladi). `requestImport` va `upload` ikkalasi ham navbatga qo'yishdan oldin chaqiradi.

- [ ] **Step 1:** Upload endpoint, mapper, konfiguratsiya.
- [ ] **Step 2: Tekshirish.** `./mvnw test` yashil. Soxta stack bilan: `curl -X POST -H "X-API-Key: dev-admin-key" -F file=@dev/fake-faceit/__files/demos/sample.dem localhost:3000/api/v1/matches/<id>/demo/upload` → 202 `STORED`; `file=@README.md` → 400; importdan keyin `SELECT count(*) FROM players WHERE steam_id IS NOT NULL` → 10.
- [ ] **Step 3: Commit** — `feat(demo): add manual demo upload and roster SteamID mapping`

---

### Task 5: Rust parser worker

**Files:**
- Create: `parser/Cargo.toml`, `parser/Cargo.lock`, `parser/Dockerfile`, `parser/.dockerignore`, `parser/src/{main,config,messages,storage,parse,bins,sink}.rs`, `parser/README.md`
- Modify: `docker-compose.yml` (`parser` servisi), `.gitignore` (`parser/target/`)

**Interfaces:**
- Muhit: `AMQP_URL` (`amqp://guest:guest@rabbitmq:5672/%2f`), `DATABASE_URL` (`postgres://csfaceit:csfaceit@postgres:5432/csfaceit`), `S3_ENDPOINT` (`http://minio:9000`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` (`csfaceit`), `S3_REGION` (`us-east-1`). Path-style S3 manzillash.
- `main`: `demo.parse` dan `basic_qos(1)` bilan iste'mol; navbat hali yo'q bo'lsa kutib qayta urinadi (topologiyani backend e'lon qiladi; parser e'lon qilmaydi). Har xabar: S3'dan vaqtinchalik faylga → zstd ochish → `parse::parse_demo` → `sink::write` → `demo.parsed` ga `{"demoId","faceitMatchId"}` → `ack`. Har qanday xato: `demos.status='FAILED'`, `error=<qisqa matn>`, `nack(requeue=false)` (DLQ). Panic'lar ushlanadi (`spawn_blocking` + `JoinError`), jarayon yiqilmaydi.
- `parse::parse_demo(path) -> Result<Facts>`; `Facts { tick_rate, map_name, rounds: Vec<Round>, kills: Vec<Kill>, damages: Vec<Damage>, positions: Vec<Position> }`:
  - `Round { round_number (1 dan), winner_side: Option<"CT"|"T">, win_reason, start_tick, end_tick, bomb_planted_tick, bomb_defused_tick, defuser_steam_id }` — warmup roundlari kirmaydi.
  - `Kill { round_number, tick, killer_steam_id: Option, victim_steam_id, assister_steam_id: Option, weapon, headshot, wallbang (penetrated > 0), noscope, thrusmoke, attacker_blind, killer_side, victim_side, killer_x, killer_y, victim_x, victim_y }`
  - `Damage { round_number, tick, attacker_steam_id: Option, victim_steam_id, weapon, damage_health, damage_armor }`
  - `Position { tick, steam_id, side, x, y }` — tirik o'yinchilar, har 32 tickda.
  - Demo o'qish uchun `LaihoE/demoparser` Rust crate'i (git dependency, aniq commit'ga qotirilgan). Uning haqiqiy API'si manba kodidan o'qib olinadi.
- `bins::aggregate(&Facts) -> Vec<HeatBin { steam_id, kind, side, bin_x, bin_y, count }>` — `kill` (killer pozitsiyasi), `death` (victim pozitsiyasi), `movement` (Position); `bin = floor(coord / 64.0)`.
- `sink::write(pool, demo_id, &Facts, bins)` — **bitta tranzaksiya**: `demos` dan `match_id`; SteamID → `players.id` (`steam_id` bo'yicha; topilmasa `INSERT players(faceit_id='steam:<id>', nickname=<demo'dagi nom>, steam_id)`); `DELETE FROM heat_bins/damages/kills/rounds WHERE match_id=$1`; batch `INSERT`; `matches.map_name` NULL bo'lsa demo'dagisi bilan to'ldiriladi; `UPDATE demos SET status='PARSED', tick_rate=$2, error=NULL, updated_at=now()`.
- `Dockerfile`: ikki bosqich (`rust:1-bookworm` → `debian:bookworm-slim`), root bo'lmagan foydalanuvchi. Compose: `parser` (`build: ./parser`, `depends_on` rabbitmq/minio/postgres healthy, `restart: unless-stopped`).

- [ ] **Step 1:** Crate, modullar, Dockerfile, compose.
- [ ] **Step 2: Tekshirish.** `cargo build --release` va `cargo clippy -- -D warnings` toza. Soxta stack bilan soxta `sample.dem` importi → `FAILED` + `error` matni, parser jarayoni tirik, xabar `demo.dlq` da (Review Focus 3). **Haqiqiy CS2 `.dem` topilsa** (masalan demoparser loyihasining ochiq test demolari): uni `dev/fake-faceit/__files/demos/sample.dem` o'rniga lokal qo'yib import → `PARSED`; `SELECT count(*)` `rounds` ≥ 13, `kills` > 50, `damages` > 0, `heat_bins` da uch `kind`; ikkinchi import/upload → sonlar o'zgarmaydi (Review Focus 4). Haqiqiy demo topilmasa — bu hisobotda ochiq aytiladi.
- [ ] **Step 3: Commit** — `feat(parser): add Rust demo parser worker writing raw facts to PostgreSQL`

---

### Task 6: `demo.parsed` listener, saqlash muddati, metrikalar, Prometheus/Grafana, hujjatlar

**Files:**
- Create: `messaging/DemoParsedListener.java`, `demo/DemoRetentionJob.java`, `ops/prometheus/prometheus.yml`, `ops/grafana/provisioning/datasources/prometheus.yml`
- Modify: `BackendApplication.java` (`@EnableScheduling`), `application.yml` (`demo.retention-days`), `docker-compose.yml` (`prometheus`, `grafana`), `.env.example`, `README.md`, `docs/superpowers/plans/2026-10-08-00-roadmap.md`

**Interfaces:**
- `DemoParsedListener` (`demo.parsed`): `demo.pipeline.parsed` hisoblagichini oshiradi va INFO yozadi; holat `PARSED` da qoladi (`ANALYZED` ga 3-reja o'tkazadi).
- Metrikalar (Micrometer): `demo.pipeline.stage.duration` (Timer, `stage=import`), `demo.pipeline.failed` (Counter, `stage`), `demo.pipeline.parsed` (Counter). Navbat uzunligi va DLQ — RabbitMQ'ning o'z Prometheus endpointidan (`rabbitmq:15692`).
- `DemoRetentionJob` (`@Scheduled(cron = "0 0 4 * * *")`): `storage.listOlderThan("demos/", now − demo.retention-days)` → `storage.delete` va tegishli `demos.storage_key = NULL` (holat va xom faktlar o'zgarmaydi). `DEMO_RETENTION_DAYS:30`; `0` — o'chirilgan.
- Compose: `prometheus` (`prom/prometheus`, `127.0.0.1:9090`, backend `/actuator/prometheus` va `rabbitmq:15692` ni scrape qiladi), `grafana` (`grafana/grafana`, `127.0.0.1:3001`, Prometheus datasource provisioning; admin paroli `GRAFANA_ADMIN_PASSWORD` dan, default yo'q — berilmasa servis `profiles: ["observability"]` ostida ishga tushmaydi). Loki va OpenTelemetry bu rejada qo'shilmaydi (yo'l xaritasida qayd etiladi).
- README: pipeline oqimi, yangi endpointlar (`curl` misollari), yangi `.env` o'zgaruvchilari, soxta FACEIT bilan ishga tushirish, demo'ni qo'lda yuklash, RabbitMQ/MinIO/Prometheus/Grafana manzillari.

- [ ] **Step 1:** Listener, job, metrikalar, ops fayllari, compose, hujjatlar.
- [ ] **Step 2: Tekshirish.** `./mvnw test` yashil; `docker compose config -q`. Soxta stack + `--profile observability`: import → `PARSED`/`FAILED` gacha boradi; `curl localhost:9090/api/v1/targets` da backend va rabbitmq `up`; `curl -s localhost:3000/api/v1/…` hali ishlaydi; `/actuator/prometheus` da `demo_pipeline_` metrikalari. So'ng `down`.
- [ ] **Step 3: Commit** — `feat(demo): add parsed listener, retention job and Prometheus/Grafana wiring`

---

## O'z-o'zini tekshirish

- Spec 6: import endpoint va navbat (T2), import worker va saqlash (T3), zaxira upload (T4), parser va faktlar (T5), `demo.parsed` (T6), idempotentlik (T2, T3, T5), DLQ/`FAILED` (T3, T5), tick tezligi va pozitsiya binlari (T5), zstd (T3), 30 kunlik tozalash (T6). Spec 11 jadvallari va indekslari (T2). Spec 13: Prometheus/Grafana (T6); Loki/OTel kechiktirildi.
- Haqiqiy FACEIT'ga bog'liq qolganlar: `demo_url` to'g'ridan-to'g'ri yuklanadimi yoki Downloads API imzolangan URL kerakmi — kalit bo'lganda tekshiriladi; hozircha 403/404 `FAILED` + qo'lda upload yo'li bilan qoplangan.
- 3-rejaga ta'sir: bomb/side/assister ustunlari V2 da bor — 3-rejaning `V3` si ularni qayta qo'shmasligi kerak.
