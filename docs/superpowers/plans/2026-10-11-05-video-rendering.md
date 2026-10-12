# 5-quyi loyiha: Video rendering — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight yonidagi bitta tugma bilan shu voqeaning MP4 klipi yoziladi: backend klipni navbatga qo'yadi, yozuvchi worker demoni CS2 da o'ynatib yozadi va faylni yuklaydi, klip saytda ko'riladi va yuklab olinadi; o'yinchining matchdagi hamma kill'lari uchun kompilyatsiya ham shu zanjirda yoziladi.

**Architecture:** Backend'da yangi `clip/` paketi. `clips` jadvalidagi bir qator ham navbatdagi ish, ham natija. Yozuvchi worker (`recorder/`, Node.js/TypeScript) backend'ga faqat HTTPS orqali, worker tokeni bilan ulanadi: ishni o'zi so'rab oladi, demoni backend'dan oladi, MP4 va thumbnail'ni backend'ga yuklaydi; PostgreSQL, RabbitMQ va MinIO ga tegmaydi. Worker ikki rejimda ishlaydi: `csdm` (Windows: CS2 + HLAE + CS Demo Manager) va `fake` (Docker: ffmpeg sinov tasviri) — ikkinchisi butun zanjirni Windows'siz qurish va tekshirish uchun.

**Tech Stack:** Spring Boot 3.5 (`JdbcClient`, JPA, `@Scheduled`), Flyway `V4__clips.sql`; Node.js 22.15+ va TypeScript (worker; yangi kutubxonasiz — `fetch`, `node:zlib` zstd, `child_process`); ffmpeg/ffprobe; CS Demo Manager CLI (`csdm video`), HLAE; React 19, TanStack Query, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-10-11-csdemo-uz-alternative-design.md` (5, 10, 11-bo'limlar); `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (6, 7, 11, 12-bo'limlar)

**Branch:** `feature/video-rendering`, `feature/highlights-stats` ustiga quriladi. **3-reja to'liq tugagan bo'lishi shart.**

## Global Constraints

- **Yangi test yozilmaydi** (foydalanuvchi qarori). Mavjud testlar yashil qolishi shart; mavjud test faqat reja ataylab o'zgartirgan xatti-harakat uchun va eng kichik hajmda tahrirlanadi. Har vazifa ishlab turgan stack'dagi aniq tekshiruv bilan tugaydi.
- `V1`–`V3` o'zgartirilmaydi. Sxemaga hamma qo'shimcha bitta `V4__clips.sql` da (Task 1 to'liq yaratadi, keyingi vazifalar unga tegmaydi). `parser/` o'zgarmaydi.
- **3-reja shartnomalari iste'mol qilinadi, o'zgartirilmaydi:** `analysis/highlight/{Highlight,HighlightRepository,HighlightType}`, `analysis/api/HighlightQueryService`, `analysis/api/dto/HighlightResponse`, `frontend/src/components/HighlightList.tsx`, `frontend/src/lib/adminKey.ts`.
- **Bitta highlight `HighlightQueryService.find(long highlightId) -> Optional<HighlightResponse>` orqali o'qiladi** (3-reja yakuniy review'i, 2026-10-12), `HighlightRepository.findById` orqali emas: highlight'lar faqat demosi `ANALYZED` bo'lganda beriladi va bu qoida shu servisda yashaydi. Demosi `ANALYZED` bo'lmagan highlight — 404 `HIGHLIGHT_NOT_FOUND`.
- **Klip highlight'ga tabiiy kalit bilan bog'lanadi:** `(match_id, player_id, highlight_type, round_number, tick_start)`. `highlights.id` saqlanmaydi — qayta tahlil highlight qatorlarini almashtiradi. `tick_start` 3-rejaning `analysis.clip.pre-seconds` sozlamasiga bog'liq (highlight faqat kengaytirilgan ticklarini saqlaydi): birinchi klip yozilgandan keyin `analysis.clip.pre-seconds`/`post-seconds` o'zgartirilmaydi, aks holda mavjud kliplar highlight'idan uziladi. Task 1 shu cheklovni README'ga yozadi; sozlamani o'zgartirish kerak bo'lsa, avval highlight'ga hodisaning o'z ticklari qo'shiladi (yangi migratsiya) va kalit shunga ko'chiriladi.
- **3-rejadan ma'lum bo'lgan chegaralar (2026-10-12):** `NINJA_DEFUSE` interfeysda `DEFUSE` deb ko'rsatiladi (qoida haqiqiy ninja defuse'ni ajrata olmaydi) — klip nomi va kartasi ham shu yorliqni ishlatadi (`lib/highlightLabels.ts`); bitta matchdagi highlight'larning yarmidan ko'pi tutun orqali bitta kill bo'lishi mumkin va maxsus kill'lar ko'pincha shu o'yinchining multi-kill oynasi ichida yotadi — qaysi turlar klip sifatida taklif qilinishi Task 6 dan oldin foydalanuvchi bilan hal qilinadi; saqlash muddati tugagan demo `ANALYZED` qoladi, lekin `storage_key` yo'q (pastdagi "Demo fayli bor bo'lgandagina" qoidasi shuni ushlaydi); saqlangan fayl tahlil qilingan faylning o'zi ekanini tekshiradigan kontent xeshi yo'q (yuklash obyektni qator commit bo'lishidan oldin yozadi).
- **Holatlar:** `QUEUED → RECORDING → ENCODING → UPLOADING → DONE`; faol holat — `RECORDING`, `ENCODING`, `UPLOADING`; faol holatdan `FAILED` yoki (qayta urinish) `QUEUED`. Holat faqat qator qulfi ostida o'zgaradi. `DONE` va `FAILED` — yakuniy.
- **Worker faqat worker API'ni biladi** (`/api/worker/v1/**`, `X-Worker-Token`). Bu yo'l `/api/v1/**` dan tashqarida, shuning uchun GET'lari ochiq emas. `CLIP_WORKER_TOKEN` bo'sh bo'lsa hamma worker so'rovi rad etiladi. Admin kaliti worker huquqini bermaydi, worker tokeni admin huquqini bermaydi.
- **Segment qoidasi:** o'yinchining raqib kill'lari ticklari bo'yicha (`killer_id = o'yinchi`, `killer_id <> victim_id`, `killer_side IS DISTINCT FROM victim_side`), har biri uchun `[t − pre × rate, t + post × rate]`, oyna chegarasiga qirqiladi; orasi `merge-gap × rate` dan kichik bo'lganlar birlashtiriladi; kill bo'lmasa — oynaning o'zi. `rate` — `demos.tick_rate` (yo'q bo'lsa 64).
- **Demo fayli bor bo'lgandagina:** `demos.storage_key IS NOT NULL` va holat `PARSED` yoki `ANALYZED`. Aks holda so'rov rad etiladi; navbatdagi klip esa `FAILED` bo'ladi, qayta urinilmaydi.
- **Fayllar xotiraga yuklanmaydi:** demo, video va thumbnail oqim bilan uzatiladi; yuklangan fayl vaqtinchalik faylga yozilib, so'ng `StorageService.put` ga beriladi.
- Chegaralar konfiguratsiyada (`clip.*`), kodda sehrli son yo'q. Sirlar faqat muhit o'zgaruvchilaridan.
- 1–2-rejalar andozalari: tranzaksiyasiz servis + alohida `@Transactional` persistence bean; tranzaksiya ichida tarmoq yoki fayl amali yo'q; umumiy `ApiError`; `matchId`/`playerId` uchun mavjud `@Pattern` konstantalari.
- Hujjat tili o'zbekcha; kod, izoh, log va commit matnlari inglizcha.
- **UI dizayni (2026-10-11 dan):** Task 6 va Task 7 dagi ko'rinish `docs/superpowers/specs/2026-10-11-web-ui-design.md` bo'yicha (maketdagi "3 · Match", "4 · Klip buyurtmasi", "5 · Kliplar", "6 · Klip sahifasi"); matnlar `frontend/src/i18n` lug'atlarida ikki tilda (`uz`, `en`). Shu rejadagi UI tavsifi dizayn spec'iga zid kelsa, spec ustun.

## Review Focus

Test yozilmagani uchun quyidagilar review'da kodni o'qib va egasi vazifaning "Tekshirish" qadamida qo'lda tekshiriladi.

1. **Worker ish o'rtasida yo'qoladi** (kompyuter uxlaydi, o'yin yiqiladi, tarmoq uziladi): klip faol holatda abadiy qolmaydi — `clip.stale-after` dan keyin navbatga qaytadi, urinishlar `clip.max-attempts` bilan chegaralangan; eskirgan worker'ning kechikkan progress/yuklash/yakunlash so'rovi 409 oladi va natijani buzmaydi (Task 2).
2. **Demo yo'qolgan yoki almashtirilgan:** tozalash job'i faylni o'chirgan yoki demo qayta yuklangan bo'lsa, klip aniq xato bilan `FAILED` bo'ladi, cheksiz qayta urinilmaydi; yangi so'rov 409 oladi (Task 1, 2).
3. **Qayta tahlildan keyin:** highlight id'lari o'zgaradi, mavjud kliplar o'z highlight'iga bog'liq qoladi; eski id bilan so'rov 404 (Task 1, 6).
4. **Takroriy so'rov** (ikki marta bosish, ikki brauzer): bir highlight va sifat uchun bitta jonli klip; ikkinchi so'rov o'sha klipni qaytaradi, ikkinchi yozuv boshlanmaydi (Task 1).
5. **Katta fayl va Range:** video `Range` so'rovlariga 206 bilan javob beradi (Safari va iOS usiz o'ynatmaydi); bir necha yuz megabaytli yuklash xotirani to'ldirmaydi; chegaradan katta fayl 413 oladi (Task 2, 3).

---

## Fayl tuzilmasi

```
backend/src/main/resources/db/migration/V4__clips.sql              # Task 1 (to'liq)
backend/src/main/java/io/csfaceit/backend/clip/
├── ClipProperties, ClipKind, ClipStatus, ClipQuality, ClipSegment, Clip (entity), ClipRepository
├── ClipFacts (JdbcClient: kill ticklari, round oynalari), SegmentBuilder
├── ClipService, ClipPersistence, ClipController, ClipMediaController, ClipRetentionJob, ClipMetrics
├── dto/    ClipRequest, CompilationRequest, ClipResponse, ClipPageResponse, RecorderStatusResponse
└── worker/ WorkerTokenAuthFilter, WorkerController, WorkerService, WorkerPersistence, StaleClipJob,
            dto/{ClaimRequest,WorkerJob,ProgressRequest,CompleteRequest,FailRequest,HeartbeatRequest}
backend/src/main/java/io/csfaceit/backend/storage/{StorageService,LocalStorage,MinioStorage}.java   # size, ranged get
backend/src/main/java/io/csfaceit/backend/config/SecurityConfig.java                                # worker yo'li
backend/src/main/java/io/csfaceit/backend/common/api/TooManyRequestsException.java
frontend/nginx.conf                                                 # worker yuklash va video uchun location
recorder/
├── package.json, tsconfig.json, Dockerfile, README.md, csdm-config.template.jsonc
└── src/{main,config,api,demoCache,media}.ts, src/recorders/{recorder,fake,csdm}.ts
frontend/src/components/{ClipButton,ClipOrderDialog,ClipCard,ViewfinderFrame,StatusChip,RecorderBanner}.tsx
frontend/src/pages/{ClipsPage,ClipPage}.tsx
```

## Tekshirish muhiti (hamma vazifa uchun)

- Soxta FACEIT stack'i: `docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait`; UI/API `http://localhost:3000`, admin kaliti `dev-admin-key`, worker tokeni `dev-worker-token` (Task 2 qo'shadi), namunaviy match `1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`.
- Haqiqiy demo `dev/fake-faceit/__files/demos/local.dem` (git-ignore) shu matchga upload qilinadi va tahlil qilinadi; highlight'lar 3-reja tekshiruvlarida sanalgan.
- SQL: `docker compose … exec -T postgres psql -U csfaceit -d csfaceit`.
- Yozuvchi kompyuter faqat Task 0 va Task 5 uchun kerak.

## Bajarish tartibi

`1 → 2 → 3 → 4 → 6 → 7 → 8`. Task 0 foydalanuvchi ishtirokida, istalgan paytda; Task 5 — Task 0 va Task 4 dan keyin. Task 5 bajarilmaguncha zanjir soxta recorder bilan ishlaydi.

---

### Task 0: Sinov — Windows kompyuterda demodan MP4 yozish (foydalanuvchi ishtirokida)

Kod yozilmaydi. Maqsad — yozish usuli ishlashini isbotlash va Task 5 uchun aniq qiymatlarni olish.

- [ ] **Step 1: O'rnatish.** Windows 10/11, diskret GPU. Yozish uchun **alohida Steam hisobi**; CS2 o'rnatiladi va bir marta qo'lda ishga tushiriladi. CS Demo Manager o'rnatiladi (u so'ragan PostgreSQL bilan); HLAE va FFmpeg'ni CS:DM o'zi o'rnatadi.
- [ ] **Step 2: Ilovada yozish.** Yangi (oxirgi kunlardagi) FACEIT demosi analiz qilinadi; Video bo'limida bitta kill atrofida sequence (o'yinchiga fokus), HLAE + FFmpeg, 1280×720, 60 FPS → MP4 o'ynalishi tasdiqlanadi.
- [ ] **Step 3: Konfiguratsiyani eksport.** Video ko'rinishidagi menyu → "Export as JSON" → `recorder/csdm-config.template.jsonc` sifatida saqlanadi (maydon nomlari Task 5 uchun manba).
- [ ] **Step 4: CLI.** `csdm video --config-file <fayl>` va `csdm video "<demo>" <startTick> <endTick> --recording-system HLAE --encoder-software FFmpeg --focus-player <steamID64> --width 1280 --height 720 --framerate 60 --close-game-after-recording` terminaldan, ilovasiz ishlashi tasdiqlanadi. Beshta sequence bitta videoga birlashtirilishi (`--concatenate-sequences`) sinaladi.
- [ ] **Step 5: Tick mosligi.** Shu demo bizning stack'ga upload qilinadi; bazadagi bitta `kills.tick` olinadi, `[tick − 3 s, tick + 2 s]` yoziladi — kill videoning 3-soniyasida ko'rinishi kerak. Farq bo'lsa, kattaligi yoziladi.
- [ ] **Step 6: O'lchovlar yo'l xaritasiga yoziladi:** CS2 build, CS:DM va HLAE versiyalari; 10 soniyalik klip va 5 sequence'li klip uchun devor vaqti; chiqish fayli nomi va hajmi; Steam ochiq turishi shartmi; ekran qulflangan yoki oyna fokusda bo'lmaganda yozadimi; `local.dem` hozirgi o'yin versiyasida o'ynaladimi.

**Natija:** davom etish yoki yo'q qarori. Ishlamasa — Task 5 o'rniga o'z HLAE drayveri uchun alohida spec yoziladi; Task 1–4 va 6–8 bunga bog'liq emas.

---

### Task 1: `V4__clips.sql`, klip modeli va klip so'rash API'si

**Files:**
- Create: `backend/src/main/resources/db/migration/V4__clips.sql`; `clip/{ClipProperties,ClipKind,ClipStatus,ClipQuality,ClipSegment,Clip,ClipRepository,ClipFacts,SegmentBuilder,ClipService,ClipPersistence,ClipController}.java`; `clip/dto/{ClipRequest,ClipResponse,ClipKill,ClipPageResponse}.java`; `common/api/TooManyRequestsException.java`
- Modify: `common/api/ApiExceptionHandler.java` (429), `backend/src/main/resources/application.yml` (`clip.*`), `README.md`

**Interfaces:**
- `V4__clips.sql` (aynan, to'liq):
  - `CREATE TABLE clips (id BIGSERIAL PRIMARY KEY, match_id BIGINT NOT NULL REFERENCES matches(id), player_id BIGINT NOT NULL REFERENCES players(id), kind VARCHAR(16) NOT NULL, highlight_type VARCHAR(32), round_number INTEGER, tick_start INTEGER, tick_end INTEGER, quality VARCHAR(8) NOT NULL, fps INTEGER NOT NULL, segments JSONB NOT NULL, status VARCHAR(16) NOT NULL, progress INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, claimed_by VARCHAR(64), claimed_at TIMESTAMPTZ, heartbeat_at TIMESTAMPTZ, video_key VARCHAR(255), thumbnail_key VARCHAR(255), duration_ms INTEGER, size_bytes BIGINT, width INTEGER, height INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ);`
  - `CREATE INDEX idx_clips_queue ON clips (created_at, id) WHERE status = 'QUEUED';` `CREATE INDEX idx_clips_match ON clips (match_id);` `CREATE INDEX idx_clips_player ON clips (player_id, created_at DESC);`
  - `CREATE UNIQUE INDEX uq_clips_highlight ON clips (match_id, player_id, highlight_type, round_number, tick_start, quality) WHERE kind = 'HIGHLIGHT' AND status <> 'FAILED';`
  - `CREATE UNIQUE INDEX uq_clips_compilation ON clips (match_id, player_id, quality) WHERE kind = 'COMPILATION' AND status <> 'FAILED';`
  - `CREATE TABLE clip_workers (name VARCHAR(64) PRIMARY KEY, version VARCHAR(32), mode VARCHAR(16), state VARCHAR(16) NOT NULL, current_clip_id BIGINT, last_seen_at TIMESTAMPTZ NOT NULL);`
- `clip.*` (`ClipProperties`, `@ConfigurationProperties("clip")`): `worker-token: ${CLIP_WORKER_TOKEN:}`, `fps: 60`, `pre-seconds: 3`, `post-seconds: 2`, `merge-gap-seconds: 4`, `max-duration-seconds: 300`, `max-queued: 50`, `max-attempts: 3`, `stale-after: 3m`, `worker-online-within: 90s`, `retention-days: ${CLIP_RETENTION_DAYS:30}`, `retention-cron: "0 30 4 * * *"`, `upload-max-size: ${CLIP_UPLOAD_MAX_SIZE:1GB}`.
- `enum ClipKind { HIGHLIGHT, COMPILATION }`; `enum ClipStatus { QUEUED, RECORDING, ENCODING, UPLOADING, DONE, FAILED }` + `boolean isActive()`; `enum ClipQuality { P720("720p", 1280, 720), P1080("1080p", 1920, 1080) }` — JSON va baza qiymati yorliq (`"720p"`), `@JsonValue`/`@JsonCreator` va `AttributeConverter`; `record ClipSegment(int startTick, int endTick)`.
- `Clip` (JPA entity; `segments` — `@JdbcTypeCode(SqlTypes.JSON) List<ClipSegment>`). Holat o'tishlari entity metodlarida, noto'g'ri o'tish `IllegalStateException`.
- `ClipFacts` (`JdbcClient`, faqat o'qish): `List<Integer> killTicks(long matchId, long playerId, int roundNumber, int fromTick, int toTick)`; `List<RoundKills> killTicksByRound(long matchId, long playerId)` (`record RoundKills(int roundNumber, int startTick, int endTick, List<Integer> ticks)`); ikkalasi faqat raqib kill'lari, tick bo'yicha tartibda. Klip sahifasi uchun: `List<KillRow> killsIn(long matchId, long playerId, int fromTick, int toTick)` (`record KillRow(int tick, String weapon, boolean headshot, String victimNickname)`), shu qoida va tartibda.
- `SegmentBuilder.build(List<Integer> killTicks, int windowStart, int windowEnd, int tickRate, ClipProperties properties) -> List<ClipSegment>` — Global Constraints'dagi qoida; sof funksiya.
- `ClipService.requestHighlightClip(long highlightId, ClipQuality quality) -> ClipCreation` (`record ClipCreation(ClipResponse clip, boolean created)`). Tartib: highlight yo'q → 404 `HIGHLIGHT_NOT_FOUND`; demo sharti buzilgan → 409 `DEMO_NOT_AVAILABLE`; o'yinchida `steamId` yo'q → 409 `PLAYER_STEAM_ID_UNKNOWN`; tabiiy kalit + sifat bo'yicha `FAILED` bo'lmagan klip bor → o'shani qaytaradi (`created = false`); `QUEUED` soni `max-queued` ga yetgan → 429 `CLIP_QUEUE_FULL`; segmentlar umumiy uzunligi `max-duration-seconds` dan oshsa → 409 `CLIP_TOO_LONG`; aks holda `QUEUED` qator. Unique indeks poygasi → mavjud qator qayta o'qiladi.
- `record ClipRequest(ClipQuality quality)` (`null` → `P720`).
- `record ClipResponse(long id, ClipKind kind, ClipStatus status, int progress, String matchId, String mapName, String playerId, String nickname, HighlightType highlightType, Integer roundNumber, Integer tickStart, ClipQuality quality, int fps, Integer durationMs, Long sizeBytes, String error, Integer queuePosition, String videoUrl, String thumbnailUrl, Instant createdAt, Instant finishedAt, Instant expiresAt, List<ClipKill> kills)` — `matchId` = FACEIT match id, `playerId` = `players.faceit_id`; `queuePosition` faqat `QUEUED` da (1 dan); `videoUrl`/`thumbnailUrl` faqat `DONE` da (`/api/v1/clips/{id}/video`, `/api/v1/clips/{id}/thumbnail`); qolgan hollarda `null`. `expiresAt` — `finishedAt + clip.retention-days`, faqat `DONE` da (`retention-days = 0` → `null`). `kills` — klip segmentlari ichidagi kill'lar, video vaqt chizig'i bo'yicha: `record ClipKill(int offsetMs, String weapon, boolean headshot, String victimNickname)`, `offsetMs` — oldingi segmentlar uzunligi yig'indisi + shu segment boshidan kill'gacha bo'lgan vaqt (`tick_rate` bilan); faqat `GET /api/v1/clips/{clipId}` da to'ldiriladi, ro'yxat endpointlarida bo'sh ro'yxat. `record ClipPageResponse(List<ClipResponse> items, int offset, int limit)`.
- Endpointlar: `POST /api/v1/highlights/{highlightId}/clips` (`X-API-Key`) → 201 (yangi) yoki 200 (mavjud) + `ClipResponse`; `GET /api/v1/clips/{clipId}` → 200 yoki 404 `CLIP_NOT_FOUND`; `GET /api/v1/matches/{matchId}/clips` → `List<ClipResponse>`, `created_at DESC`; `GET /api/v1/players/{playerId}/clips?offset=0&limit=20` va `GET /api/v1/clips?offset=0&limit=20` (faqat `DONE`) → `ClipPageResponse`, `limit` 1–100. O'qish endpointlari faqat bazadan o'qiydi; noma'lum match yoki o'yinchi → bo'sh ro'yxat.

- [ ] **Step 1:** Migratsiya, model, `ClipFacts`, `SegmentBuilder`, servis, kontroller, konfiguratsiya, README bo'limi (endpointlar va xato kodlari).
- [ ] **Step 2: Tekshirish.** `./mvnw test` yashil (`V4` `ddl-auto=validate` dan o'tadi). Stack'da haqiqiy demo tahlil qilingach: (a) ACE yoki 3K highlight uchun `POST …/clips` → 201, `status = QUEUED`, `queuePosition = 1`; bazadagi `segments` shu o'yinchining shu rounddagi raqib kill'lari bilan qo'lda hisoblangan qiymatga teng (SQL va hisob hisobotga yoziladi); (b) o'sha so'rov takror → 200, o'sha `id`, jadvalda bitta qator; (c) `{"quality":"1080p"}` → yangi qator; (d) ninja defuse highlight'i → bitta segment, highlight oynasiga teng; (e) kalitsiz `POST` → 401; yo'q highlight → 404; (f) `UPDATE demos SET storage_key = NULL` dan keyin yangi highlight uchun so'rov → 409 `DEMO_NOT_AVAILABLE` (so'ng qiymat qaytariladi); (g) qayta tahlildan keyin (`POST …/demo/analyze`) eski highlight id → 404, o'sha voqeaning yangi id'si bilan so'rov → 200 va avvalgi klip; (h) `GET /api/v1/clips/{id}`: `kills` soni shu klip segmentlaridagi raqib kill'lari soniga teng (mustaqil SQL), birinchi `offsetMs` ≈ `pre-seconds × 1000`, ro'yxat endpointlarida `kills` bo'sh.
- [ ] **Step 3: Commit** — `feat(clip): queue clip requests for highlights with kill-based segments`

---

### Task 2: Worker API — ishni olish, progress, demo, yuklash, yakunlash

**Files:**
- Create: `clip/worker/{WorkerTokenAuthFilter,WorkerController,WorkerService,WorkerPersistence,StaleClipJob}.java`, `clip/worker/dto/{ClaimRequest,WorkerJob,ProgressRequest,CompleteRequest,FailRequest,HeartbeatRequest}.java`, `clip/dto/RecorderStatusResponse.java`
- Modify: `config/SecurityConfig.java`, `storage/{StorageService,LocalStorage,MinioStorage}.java`, `clip/ClipController.java`, `frontend/nginx.conf`, `docker-compose.yml` (`CLIP_WORKER_TOKEN: ${CLIP_WORKER_TOKEN:-}`, `CLIP_RETENTION_DAYS`), `docker-compose.fake.yml` (`CLIP_WORKER_TOKEN: dev-worker-token`), `.env.example`, `README.md`

**Interfaces:**
- `StorageService` ga qo'shiladi: `long size(String key)`; `InputStream get(String key, long offset, long length)` (ikkala implementatsiyada; yo'q kalit — mavjud `StorageException`).
- Xavfsizlik: `/api/worker/**` faqat `ROLE_WORKER`; `WorkerTokenAuthFilter` `X-Worker-Token` ni `clip.worker-token` bilan doimiy vaqtli solishtiradi, shu yo'ldan boshqasiga ta'sir qilmaydi. Token yo'q yoki noto'g'ri → mavjud 401 `ApiError`; boshqa huquq bilan kirilgan (admin kaliti) → 403 `FORBIDDEN`, shu shaklda.
- Hamma so'rov `/api/worker/v1` ostida:
  - `POST /claim` — `ClaimRequest(String worker, String version, String mode, List<ClipQuality> qualities)` → 200 `WorkerJob` yoki 204. Eng eski mos `QUEUED` qator `FOR UPDATE SKIP LOCKED` bilan olinadi → `RECORDING`, `progress = 0`, `claimed_by`, `claimed_at = heartbeat_at = now`, `attempts + 1`. Demosi yo'q klip shu yerda `FAILED` ("The demo file is no longer stored") qilinadi va keyingisi olinadi.
  - `record WorkerJob(long clipId, ClipKind kind, String matchId, String mapName, String focusSteamId, int tickRate, List<ClipSegment> segments, int width, int height, int fps, long demoSizeBytes, String demoVersion)` — `demoVersion` = demo `updated_at` (epoch millis): worker keshi kaliti.
  - `POST /clips/{id}/progress` — `ProgressRequest(String worker, ClipStatus stage, int progress)`; `stage` ∈ faol holatlar, `progress` 0–100 → 204, `heartbeat_at = now`.
  - `GET /clips/{id}/demo?worker=` → 200, `application/zstd`, `Content-Length`; demo yo'q → 410 `DEMO_NOT_AVAILABLE`.
  - `PUT /clips/{id}/video?worker=` (`video/mp4`, xom tana) → 204; `clips/{id}.mp4` ga yoziladi, `status = UPLOADING`, `size_bytes`. `PUT /clips/{id}/thumbnail?worker=` (`image/jpeg`) → 204; `clips/{id}.jpg`. `clip.upload-max-size` dan katta → 413 `PAYLOAD_TOO_LARGE`.
  - `POST /clips/{id}/complete` — `CompleteRequest(String worker, int durationMs, int width, int height)` → 204; `video_key` yo'q → 409 `CLIP_VIDEO_MISSING`; `DONE`, `progress = 100`, `finished_at`.
  - `POST /clips/{id}/fail` — `FailRequest(String worker, String error, boolean retryable)` → 204; `retryable` va `attempts < max-attempts` → `QUEUED` (`claimed_by = NULL`, `error` saqlanadi), aks holda `FAILED`.
  - `POST /heartbeat` — `HeartbeatRequest(String worker, String version, String mode, String state, Long clipId)` (`state` ∈ `IDLE`, `WORKING`) → 204; `clip_workers` upsert. `claim` va `progress` ham `last_seen_at` ni yangilaydi.
  - Klip shu worker'ga tegishli bo'lmasa yoki faol holatda bo'lmasa — hamma `/clips/{id}/…` so'rovi 409 `CLIP_NOT_CLAIMED`.
- `StaleClipJob` (`@Scheduled`, har 30 s): `heartbeat_at < now − clip.stale-after` bo'lgan faol kliplar → `attempts < max-attempts` bo'lsa `QUEUED`, aks holda `FAILED` ("The recorder stopped responding").
- `GET /api/v1/recorder/status` → `RecorderStatusResponse(boolean online, Instant lastSeenAt, int queued, int active)`; `online` — biror worker `clip.worker-online-within` ichida ko'ringan.
- Nginx: `^/api/worker/v1/clips/[0-9]+/(video|thumbnail)$` uchun `client_max_body_size 1g`, `proxy_request_buffering off`, 600 s timeout (demo upload location'i andozasida).

- [ ] **Step 1:** Storage qo'shimchalari, filtr va xavfsizlik qoidasi, worker servisi va kontrolleri, eskirgan kliplar job'i, holat endpointi, Nginx, Compose, `.env.example`, README (worker protokoli jadvali).
- [ ] **Step 2: Tekshirish** (`curl` bilan worker rolida; buyruqlar va javoblar hisobotga yoziladi). `./mvnw test` yashil. (a) tokensiz yoki noto'g'ri token bilan `POST /claim` → 401; faqat admin kaliti bilan → 403; `GET /api/worker/v1/clips/1/demo` tokensiz → 401; worker tokeni bilan `POST /api/v1/highlights/{id}/clips` → 401; (b) navbatda klip bor: `claim` → 200, `segments` Task 1 dagi bilan bir xil, bazada `RECORDING`, `attempts = 1`; ikkinchi `claim` → 204; (c) `demo` yuklanadi: hajmi `demoSizeBytes` ga teng, `zstd -t` o'tadi; (d) `progress` → `GET /api/v1/clips/{id}` da ko'rinadi; boshqa `worker` nomi bilan → 409; (e) ffmpeg bilan yasalgan 5 soniyalik MP4 va JPEG yuklanadi, `complete` → `DONE`; MinIO'da ikkala obyekt bor; (f) boshqa klip: `claim`, so'ng 4 daqiqa jim turiladi → `QUEUED` ga qaytgan, `attempts = 1`; uch marta takrorlangach `FAILED`; (g) eskirgan worker'ning kechikkan `complete` so'rovi → 409, holat o'zgarmagan; (h) `fail` `retryable=false` → `FAILED`, matn `error` da; (i) `GET /api/v1/recorder/status` — `claim` dan keyin `online: true`, 90 s jimlikdan keyin `false`; (j) navbatdagi klipning demosi uchun `storage_key = NULL` qilinadi → `claim` uni `FAILED` qiladi va 204 qaytaradi (so'ng qiymat qaytariladi); (k) `CLIP_UPLOAD_MAX_SIZE=1MB` bilan 5 MB fayl yuklash → 413, klip holati o'zgarmagan.
- [ ] **Step 3: Commit** — `feat(clip): add the worker API with claiming, uploads and stale-claim recovery`

---

### Task 3: Videoni berish, o'chirish va saqlash muddati

**Files:**
- Create: `clip/{ClipMediaController,ClipRetentionJob}.java`
- Modify: `clip/{ClipController,ClipService,ClipPersistence}.java`, `frontend/nginx.conf`, `README.md`

**Interfaces:**
- `GET /api/v1/clips/{clipId}/video` — faqat `DONE`; aks holda 404 `CLIP_NOT_FOUND`. `Range` yo'q → 200, to'liq; `Range: bytes=a-b` yoki `bytes=a-` (bitta oraliq) → 206, `Content-Range: bytes a-b/size`; chegaradan tashqari → 416 + `Content-Range: bytes */size`. Har doim `Accept-Ranges: bytes`, `Content-Type: video/mp4`, `Content-Length`. `?download=1` → `Content-Disposition: attachment; filename="<nickname>-<tur>-r<round>.mp4"` (kompilyatsiyada `<nickname>-compilation.mp4`; nomdagi ruxsatsiz belgilar `_` ga almashtiriladi).
- `GET /api/v1/clips/{clipId}/thumbnail` → `image/jpeg`, `Cache-Control: public, max-age=86400`; thumbnail yo'q → 404.
- `DELETE /api/v1/clips/{clipId}` (`X-API-Key`) → 204; faol holatda → 409 `CLIP_IN_PROGRESS`; yo'q → 404. Avval qator (tranzaksiya), so'ng fayllar o'chiriladi.
- `ClipRetentionJob` (`clip.retention-cron`): `finished_at` `clip.retention-days` dan eski `DONE` va `FAILED` kliplar fayllari bilan o'chiriladi; `0` — hech narsa o'chirilmaydi.
- Nginx: `^/api/v1/clips/[0-9]+/video$` uchun `proxy_buffering off`.

- [ ] **Step 1:** Media kontrolleri, o'chirish, tozalash job'i, Nginx, README.
- [ ] **Step 2: Tekshirish.** `./mvnw test` yashil. Task 2 da yuklangan klip bilan: (a) `curl -I` → 200, `Accept-Ranges: bytes`, to'g'ri `Content-Length`; (b) `-H "Range: bytes=0-99"` → 206, 100 bayt, `Content-Range` to'g'ri; `bytes=100-` → qolgan qism; ikkala qism birlashtirilganda asl fayl bilan sha256 bir xil; (c) `Range: bytes=999999999-` → 416; (d) `QUEUED` klip uchun video → 404; (e) brauzerda (Chrome va Safari) `<video>` o'ynaydi va oldinga surish ishlaydi; (f) `?download=1` nomi kutilgan shaklda; (g) `DELETE` kalitsiz → 401; kalit bilan → 204, MinIO'da obyektlar yo'q, o'sha highlight uchun yangi so'rov → 201; (h) `finished_at` 31 kun orqaga surilgan klip job qo'lda ishga tushirilgach o'chadi; (i) `DONE` klipda `expiresAt = finishedAt + 30 kun`, `CLIP_RETENTION_DAYS=0` bilan `null`.
- [ ] **Step 3: Commit** — `feat(clip): serve clip video with range support, deletion and retention`

---

### Task 4: Recorder worker va soxta yozish rejimi

**Files:**
- Create: `recorder/{package.json,tsconfig.json,Dockerfile,README.md}`, `recorder/src/{main,config,api,demoCache,media}.ts`, `recorder/src/recorders/{recorder,fake}.ts`
- Modify: `docker-compose.fake.yml` (`recorder-fake` xizmati), `.gitignore` (`recorder/node_modules`, `recorder/dist`, `recorder/work`), `README.md`

**Interfaces:**
- Muhit (`config.ts`): `BACKEND_URL`, `CLIP_WORKER_TOKEN`, `WORKER_NAME` (standart — hostname), `RECORDER_MODE` (`fake` | `csdm`), `WORK_DIR` (`./work`), `POLL_SECONDS` (5), `HEARTBEAT_SECONDS` (30), `DEMO_CACHE_ITEMS` (5), `QUALITIES` (`720p,1080p`), `FFMPEG_PATH`, `FFPROBE_PATH`, `ERROR_BACKOFF_SECONDS` (300). Majburiy qiymat yo'q bo'lsa — aniq xabar bilan chiqadi.
- `api.ts`: Task 2 dagi har so'rov uchun bitta funksiya; 409 → `ClaimLostError` (ish to'xtatiladi, `fail` yuborilmaydi); tarmoq xatosi va 5xx — eksponensial kutish bilan 5 martagacha.
- `demoCache.ts`: `ensure(job) -> demPath` — `<WORK_DIR>/demos/<matchId>-<demoVersion>.dem`; yo'q bo'lsa yuklaydi (`Content-Length` tekshiriladi), `node:zlib` `createZstdDecompress` bilan ochadi, vaqtinchalik nomdan atomik ko'chiradi; `DEMO_CACHE_ITEMS` dan ortig'i (eng eskisi) o'chiriladi.
- `recorders/recorder.ts`: `interface Recorder { record(job: WorkerJob, demoPath: string, outDir: string, onProgress: (stage, percent) => void): Promise<string> }` — natija MP4 yo'li. Xatolar: `RecorderError(message, retryable)`.
- `recorders/fake.ts`: ffmpeg `testsrc2` + `sine`, o'lcham va FPS job'dan, davomiyligi `Σ(endTick − startTick) / tickRate`, kadrda klip id va o'yinchi SteamID matni; H.264 `yuv420p`, AAC, `+faststart`.
- `media.ts`: `probe(path) -> {durationMs, width, height, sizeBytes}` (ffprobe), `thumbnail(path, outPath)` (1-soniyadagi kadr, kengligi 640).
- `main.ts` sikli: har `HEARTBEAT_SECONDS` da heartbeat; `claim` → `ensure` → `record` (progress har ≤10 s) → `ENCODING`: thumbnail, probe → `UPLOADING`: video va thumbnail → `complete`. Xatoda `fail(error, retryable)`; ish papkasi har ishdan keyin tozalanadi; `SIGINT`/`SIGTERM` da joriy ish `fail(retryable = true)` bilan qaytariladi.
- `recorder/Dockerfile` (faqat `fake` rejimi uchun): `node:22-alpine` + `ffmpeg`. Compose: `recorder-fake` — `BACKEND_URL=http://backend:8080`, `CLIP_WORKER_TOKEN=dev-worker-token`, `RECORDER_MODE=fake`, `WORKER_NAME=fake-1`, `depends_on: backend (healthy)`.

- [ ] **Step 1:** Worker loyihasi, soxta rejim, Dockerfile, Compose xizmati, `recorder/README.md` (muhit o'zgaruvchilari, soxta rejimni ishga tushirish).
- [ ] **Step 2: Tekshirish.** `npm run build` va `npm run lint` toza. Stack ko'tariladi (`recorder-fake` bilan): (a) `GET /api/v1/recorder/status` → `online: true`; (b) highlight uchun klip so'raladi → aralashuvsiz `QUEUED → RECORDING → ENCODING → UPLOADING → DONE` (holatlar `GET /api/v1/clips/{id}` ni 1 soniyada bir so'rab yozib olinadi); (c) yuklab olingan video: `ffprobe` davomiyligi segmentlar yig'indisiga ±0.2 s, o'lcham sifatga mos, `duration_ms`/`size_bytes` bazada bir xil; thumbnail — JPEG; (d) ikkita klip ketma-ket so'raladi → navbat bilan, ikkalasi `DONE`; (e) yozish paytida `docker compose kill recorder-fake` → klip `clip.stale-after` dan keyin `QUEUED`; `docker compose stop recorder-fake` (SIGTERM) → darhol `QUEUED`; ikkala holda xizmat qayta ishga tushgach `DONE`, `attempts = 2`; (f) noto'g'ri token bilan konteyner har urinishda aniq xato yozadi va chiqib ketmaydi; (g) o'sha matchning ikkinchi klipida demo qayta yuklanmaydi (log).
- [ ] **Step 3: Commit** — `feat(recorder): add the recorder worker with a fake recording mode`

---

### Task 5: Haqiqiy yozish — Windows'da CS Demo Manager orqali (Task 0 dan keyin)

**Files:**
- Create: `recorder/src/recorders/csdm.ts`, `recorder/csdm-config.template.jsonc` (Task 0 da olingan)
- Modify: `recorder/src/{main,config}.ts`, `recorder/README.md`

**Interfaces:**
- Qo'shimcha muhit: `CSDM_PATH` (`csdm` bajariluvchi fayli), `CSDM_TIMEOUT_FACTOR` (6), `CSDM_MIN_TIMEOUT_SECONDS` (600).
- `csdm.ts` (`Recorder`): (1) demo CS:DM bazasida yo'q bo'lsa `csdm analyze "<demo>"` (bir demo uchun bir marta; belgi fayli demo yonida); (2) shablondan ish konfiguratsiyasi: `demoPath`, chiqish papkasi, `recordingSystem = HLAE`, `encoderSoftware = FFmpeg`, o'lcham, FPS, har `ClipSegment` uchun bitta sequence (fokus — `focusSteamId`), sequence'lar bitta videoga birlashtiriladi, o'yin yozuvdan keyin yopiladi; maydon nomlari Task 0 shablonidan; (3) `csdm video --config-file <fayl>`; vaqt chegarasi `max(CSDM_MIN_TIMEOUT_SECONDS, CSDM_TIMEOUT_FACTOR × klip uzunligi)`, oshsa jarayon daraxti o'ldiriladi; (4) chiqish papkasidan MP4 topiladi; kodek H.264/`yuv420p`/AAC va `+faststart` bo'lmasa ffmpeg bilan to'g'rilanadi.
- Xato tasnifi: o'yin yoki HLAE ishga tushmadi (muhit xatosi) → `retryable = true` va worker `ERROR_BACKOFF_SECONDS` davomida yangi ish olmaydi; demo o'yinning hozirgi versiyasida o'ynalmaydi → `retryable = false`, matni "This demo was recorded on a game version the recorder can no longer play"; vaqt chegarasi → `retryable = true`.
- `recorder/README.md` — Windows'ni sozlash: apparat talablari, alohida Steam hisobi, CS2 va video sozlamalari, CS:DM, Node.js 22.15+, muhit fayli, ishga tushirish, tizimga kirganda avtomatik ishga tushish (Task Scheduler), uyqu rejimi va avtomatik yangilanishlarni o'chirish, o'yin yangilanganda nima qilish.

- [ ] **Step 1:** `csdm` rejimi va qo'llanma.
- [ ] **Step 2: Tekshirish** (Windows kompyuterda, haqiqiy backend'ga ulangan holda). (a) Task 0 dagi demo upload va tahlil qilinadi; ACE yoki multi-kill highlight uchun klip so'raladi → `DONE`; videoda aynan o'sha o'yinchi ko'zidan aynan o'sha kill'lar, har biri segmentning 3-soniyasida; (b) kompilyatsiya o'rnini bosuvchi 5+ segmentli klip bitta fayl bo'lib chiqadi; (c) 720p va 1080p o'lchamlari to'g'ri; (d) yozish paytida CS2 jarayoni qo'lda o'ldiriladi → klip navbatga qaytadi va ikkinchi urinishda yoziladi; (e) uchta klip ketma-ket, aralashuvsiz; har biri uchun devor vaqti hisobotga yoziladi; (f) kompyuter qayta yoqilgach worker o'zi ishga tushadi va `online: true` bo'ladi.
- [ ] **Step 3: Commit** — `feat(recorder): record clips with CS Demo Manager on Windows`

---

### Task 6: Frontend — klip tugmasi, holat, pleyer va kliplar sahifasi

**Files:**
- Create: `frontend/src/components/{ClipButton,ClipOrderDialog,ClipCard,ViewfinderFrame,StatusChip,RecorderBanner}.tsx`, `frontend/src/pages/{ClipsPage,ClipPage}.tsx`
- Modify: `frontend/src/api/{types,queries}.ts`, `frontend/src/components/{HighlightList,HighlightCard,KillTimeline,TopBar}.tsx`, `frontend/src/pages/{MatchPage,PlayerPage}.tsx`, `frontend/src/App.tsx`, `frontend/src/i18n/{en,uz}.ts`, `frontend/e2e/shots.spec.ts`; mavjud testlar — faqat yangi so'rovlar uchun mock javob

**Interfaces:**
- `api/types.ts`: `ClipKind`, `ClipStatus`, `ClipQuality` (`'720p' | '1080p'`), `ClipResponse`, `ClipPageResponse`, `RecorderStatusResponse` — backend DTO'larining aynan nusxasi.
- `api/queries.ts`: `useMatchClips(matchId)`, `usePlayerClips(playerId, offset, limit)`, `useRecentClips(offset, limit)`, `useClip(clipId)`, `useRecorderStatus()` (60 s), `useRequestHighlightClip()`, `useDeleteClip()`. Ro'yxatda `DONE` yoki `FAILED` bo'lmagan klip bo'lsa, so'rov har 3 s da yangilanadi; aks holda yangilanmaydi.
- `clipFor(highlight, clips)` — moslik tabiiy kalit bo'yicha (`playerId`, `highlightType`, `roundNumber`, `tickStart`); bir nechta bo'lsa `DONE`, so'ng yuqori sifat ustun.
- `ClipButton` (har highlight kartasining pastida): klip yo'q → `● Klip yozish` — `ClipOrderDialog` ni ochadi (admin kaliti kiritilmagan bo'lsa o'chirilgan, sababi ko'rsatiladi); qolgan holatlar `StatusChip` bilan: `QUEUED` → "Navbatda · N", faol → bosqich nomi va foiz, `DONE` → "Ko'rish" (`/clips/:clipId` ga havola), `FAILED` → xato matni va "Qayta urinish".
- `ClipOrderDialog({ highlight, open, onClose })` (maket "4 · Klip buyurtmasi"): highlight xulosasi (teg, o'yinchi, raund, davomiylik, `KillTimeline`), sifat tanlovi (720p / 1080p, radio), navbatdagi kliplar soni (`useRecorderStatus().queued`), "Bekor qilish" va `● Yozishni boshlash`. Maketdagi Telegram belgisi va narx bu rejada yo'q (7 va 8-rejalar).
- `ClipPage` (`/clips/:clipId`, maket "6 · Klip sahifasi"; dialog o'rniga sahifa — havolasini ulashish uchun): `<video controls preload="metadata" poster>` 16:9 qutida; ostida `KillTimeline` klip rejimida (yo'l `0..durationMs`, belgilar `kills[].offsetMs`; belgi bosilsa video shu joyga o'tadi); sarlavha (tur yorlig'i · eng ko'p ishlatilgan qurol · xarita); o'yinchi va match havolalari, raund, sana; amallar: "Yuklab olish" (`?download=1`, hajmi bilan), "Havolani nusxalash", admin kaliti bo'lsa "O'chirish"; bo'limlar: "Kill'lar" (`m:ss`, qurbon, qurol, headshot), "Klip haqida" (sifat va FPS, davomiylik, hajm, yozilgan vaqt, `expiresAt` gacha saqlanishi), "Shu matchdan" (`useMatchClips`). `DONE` bo'lmagan klipda video o'rnida `StatusChip`; noma'lum id → "topilmadi" holati.
- `ViewfinderFrame` va `StatusChip` — dizayn spec 3 bo'yicha. `ClipCard`: `ViewfinderFrame` (fon — `thumbnailUrl`, bo'lmasa xarita sahnasi; yuqori-chapda `XARITA · R<raund>`, pastda davomiylik va sifat, markazda o'ynatish belgisi yoki `StatusChip`), sarlavha, meta; butun karta `/clips/:clipId` ga havola.
- `RecorderBanner`: dizayndagi `RecorderStatus` ko'rinishi (nuqta va "Yozuvchi onlayn · navbatda N"); `online = false` va navbatda klip bo'lsa — "Yozuvchi kompyuter o'chiq, kliplar navbatda kutadi".
- Match sahifasi: highlight kartalarida tugmalar va "Kliplar" bo'limi (`ClipCard`); o'yinchi sahifasi: "Kliplar" bo'limi; `/clips` — `RecorderBanner` va oxirgi tayyor kliplar to'ri, sahifalash (maketdagi holat tablari 6-rejada, klip egaligi bilan keladi); tepa panelda "Kliplar" havolasi.

- [ ] **Step 1:** Tiplar, so'rovlar, komponentlar, sahifalar, mavjud testlarga mock javoblar.
- [ ] **Step 2: Tekshirish.** `npm run lint`, `npm run build`, Vitest va Playwright yashil. Soxta recorder bilan brauzerda: (a) match sahifasida highlight kartasidagi tugma → buyurtma dialogi → navbat → foiz → "Ko'rish", sahifani yangilamasdan; (b) klip sahifasida video o'ynaydi, oldinga suriladi, kill belgisi bosilganda o'sha joyga o'tadi, yuklab olinadi, havola nusxalanadi; (c) sahifa qayta ochilganda holat saqlangan; (d) admin kalitisiz tugma o'chirilgan; (e) `recorder-fake` to'xtatilganda banner chiqadi, klip navbatda turadi; qayta yoqilganda banner yo'qoladi va klip yoziladi; (f) klip o'chirilgach highlight yana "Klip yozish" holatida; (g) `/clips` va o'yinchi sahifasida klip ko'rinadi; (h) 390 px kenglikda ham ishlaydi; (i) qayta tahlildan keyin (`POST …/demo/analyze`) tayyor klip o'z highlight'i yonida ko'rinadi; (j) `SHOTS=1 npx playwright test e2e/shots.spec.ts` skrinshotlari (yangi sahifalar va so'rovlar shu faylga qo'shiladi) 1440 va 390 kenglikda dizayn spec'iga solishtiriladi.
- [ ] **Step 3: Commit** — `feat(frontend): record, track and watch clips`

---

### Task 7: Kompilyatsiya — o'yinchining matchdagi hamma kill'lari

**Files:**
- Create: `clip/dto/CompilationRequest.java`
- Modify: `clip/{ClipController,ClipService}.java`, `frontend/src/api/{types,queries}.ts`, `frontend/src/pages/MatchPage.tsx`, `frontend/src/components/ClipCard.tsx`, `README.md`

**Interfaces:**
- `POST /api/v1/matches/{matchId}/clips` (`X-API-Key`) — `record CompilationRequest(String playerId, ClipQuality quality)` (`playerId` — mavjud o'yinchi id andozasi bilan tekshiriladi, shuning uchun `steam:<id>` vaqtinchalik o'yinchisi uchun kompilyatsiya so'rab bo'lmaydi; `quality` `null` → `P720`) → 201/200 + `ClipResponse` (`kind = COMPILATION`, highlight maydonlari `null`). `ClipService.requestCompilation(String faceitMatchId, String faceitPlayerId, ClipQuality quality) -> ClipCreation`: match yoki o'yinchi bazada yo'q → 404; demo va `steamId` shartlari Task 1 dagidek; o'yinchining raqib kill'i yo'q → 409 `NO_KILLS`; segmentlar — `ClipFacts.killTicksByRound` dan har round o'z oynasida `SegmentBuilder.build`, round tartibida; `max-duration-seconds` dan oshsa 409 `CLIP_TOO_LONG`; mavjud jonli kompilyatsiya → o'sha.
- UI: match sahifasida dizayndagi "Kompilyatsiya" paneli (qisqa matn, o'yinchi tanlovi, `● Kompilyatsiya yozish` → `ClipOrderDialog` sifat tanlovi bilan); holati va natijasi `ClipCard` da, highlight kliplari bilan bir ro'yxatda. Maketdagi ko'p segmentli `KillTimeline` va taxminiy davomiylik (buyurtmadan oldin) bu rejada yo'q: oldindan hisoblash endpointi va kirgan o'yinchi kerak — 6-rejada.

- [ ] **Step 1:** Endpoint, servis metodi, UI.
- [ ] **Step 2: Tekshirish.** `./mvnw test`, frontend tekshiruvlari yashil. Haqiqiy demoda: (a) eng ko'p kill qilgan o'yinchi uchun so'rov → 201; segmentlar soni va umumiy uzunligi mustaqil SQL bilan hisoblangan qiymatga teng; jamoadoshni o'ldirish va o'z-o'zini o'ldirish kirmagan; (b) takror → 200, o'sha klip; (c) soxta recorder bilan `DONE`, video uzunligi segmentlar yig'indisiga teng; (d) matchda o'ynamagan o'yinchi → 409 `NO_KILLS`; (e) brauzerda o'yinchi tanlab yozish va ko'rish.
- [ ] **Step 3: Commit** — `feat(clip): record a compilation of a player's kills in a match`

---

### Task 8: Metrikalar, hujjat va yakuniy tekshiruv

**Files:**
- Create: `clip/ClipMetrics.java`
- Modify: `clip/{ClipService,ClipPersistence}.java`, `clip/worker/{WorkerService,StaleClipJob}.java`, `README.md`, `.env.example`, `docs/superpowers/plans/2026-10-08-00-roadmap.md`

**Interfaces:**
- Metrikalar: `clips.requested{kind}` (counter), `clips.finished{status}` (counter), `clips.requeued` (counter), `clips.queue.size` va `clips.active` (gauge), `clips.record.duration` (timer: `claimed_at` → `finished_at`), `clips.recorder.online` (gauge 0/1).
- README: "Video kliplar" bo'limi — zanjir sxemasi, holatlar, endpointlar, worker protokoli, muhit o'zgaruvchilari, soxta rejim, `recorder/README.md` ga havola, cheklovlar (demo fayli muddati, bitta recorder).
- Yo'l xaritasi: holat, Task 0 o'lchovlari, 6–10-rejalarga shartnomalar (`ClipService.requestHighlightClip/requestCompilation`, `ClipResponse`, worker protokoli).

- [ ] **Step 1:** Metrikalar, README, `.env.example`, yo'l xaritasi.
- [ ] **Step 2: Yakuniy tekshirish.** Toza muhitdan (`down -v`): stack ko'tariladi, demo upload → tahlil → bitta highlight klipi va bitta kompilyatsiya soxta recorder bilan `DONE`; backend testlari, frontend lint/build/Vitest/Playwright yashil; `/actuator/prometheus` da yangi metrikalar; repozitoriyda sir yo'q. Task 5 bajarilgan bo'lsa — shu ssenariy haqiqiy recorder bilan takrorlanadi.
- [ ] **Step 3: Commit** — `docs(clip): document the clip pipeline and record plan 5 status`

---

## Keyingi rejalarga shartnoma

- **6-reja (hisoblar):** `POST …/clips` endpointlari foydalanuvchi sessiyasi bilan ham ishlaydi; `clips.requested_by` ustuni va "o'yinchi shu match tarkibida" tekshiruvi o'sha rejaning migratsiyasida qo'shiladi.
- **7-reja (Telegram):** klip `DONE` bo'lganda hodisa (`ClipFinished(clipId)`) — `WorkerService.complete` dan keyin, tranzaksiyadan tashqarida e'lon qilinadi.
- **8-reja (coin):** narx `ClipService` ga kirishdan oldin hisoblanadi; band qilish klip qatori bilan bir tranzaksiyada, qaytarish `FAILED` ga o'tishda.
- **10-reja (variantlar):** yozish variantlari `WorkerJob` ga yangi maydonlar bo'lib qo'shiladi; worker bilmagan maydonni e'tiborsiz qoldiradi.

## Bajarish paytidagi qarorlar (2026-10-12)

Reja bajarilayotganda chiqarilgan qarorlar. Yuqoridagi vazifa matnlari tahrirlanmagan; farq chiqqan joyda shu bo'lim ustun.

- **Task 0 va Task 5 bajarilmadi.** Ikkalasi yozuvchi Windows kompyuterni talab qiladi. `recorder/src/recorders/csdm.ts` va `recorder/csdm-config.template.jsonc` yaratilmagan; `RECORDER_MODE=csdm` berilsa, dastur ishga tushishida aniq xabar bilan to'xtaydi. Zanjir soxta recorder bilan ishlaydi va shu ikki vazifa bajarilmaguncha reja tugallangan hisoblanmaydi.
- **Parallel bajarish (foydalanuvchi ko'rsatmasi bilan).** Task 2 dan keyin vazifalar alohida git worktree va alohida Compose loyihalarida (o'z portlari bilan) bir vaqtda bajarildi; natijalar `feature/video-rendering` ga ketma-ket qo'shildi. Frontend (Task 6 va Task 7 ning interfeys qismi) backend vazifalari bilan parallel yozildi.
- **Qaysi highlight turlari klip sifatida taklif qilinadi (Task 6 dan oldingi savol):** javob bo'lmagani uchun hech bir tur yashirilmadi — har highlight kartasida klip qatori bor.
- **Klip so'rash tartibi (Task 1, review'dan keyin):** shu highlight va sifat uchun mavjud jonli klip demo va SteamID tekshiruvlaridan **oldin** qaytariladi (Task 1 matnida keyin edi). Demo fayli muddati tugab o'chirilgan bo'lsa ham takroriy so'rov 409 emas, mavjud klipni beradi. Kompilyatsiya so'rovi ham shu tartibda.
- **O'qish tomoni alohida servisda (Task 1):** `clip/ClipQueryService` (fayl ro'yxatida yo'q edi) — ro'yxatlar, bitta klip, `queuePosition`, kill'lar vaqt chizig'i. Bu build tanimaydigan qiymatli qator (tur, holat, sifat) ro'yxatdan tashlab ketiladi va WARN yoziladi, id bo'yicha so'ralsa 404 — highlight'lardagi qoida.
- **Ro'yxatlar (Task 1):** `GET /api/v1/players/{playerId}/clips` hamma holatdagi kliplarni beradi; faqat `GET /api/v1/clips` `DONE` bilan cheklangan.
- **Holat mashinasi (Task 1–2):** `finished_at` `FAILED` da ham yoziladi (tozalash job'i ikkalasini shu ustun bo'yicha tanlaydi); navbatga qaytgan klip da'vosini, progress'ini va urinish yuklagan fayl kalitlarini yo'qotadi; yangi urinish boshlanganda (`claim`) oldingi urinishning `error` matni tozalanadi; saqlagich ishlamay turganda olingan klip urinishi sanalmasdan navbatga qaytariladi.
- **Har urinish o'z faylida (Task 2, review'dan keyin):** video va thumbnail `clips/{id}-{urinish}.mp4` va `.jpg` kalitlarida saqlanadi (`ClipFiles`; Task 2 matnidagi qat'iy `clips/{id}.mp4` o'rniga). Da'vosini yo'qotgan recorder sekin yuklash paytida g'olib urinishning faylini almashtira olmaydi; qatordagi `video_key` va `thumbnail_key` qaysi urinish fayllari klipniki ekanini aytadi; so'rov faqat recorder nomiga emas, o'zi boshlangan urinishga ham bog'lanadi; da'vo yuklash boshida, fayl saqlagichga yozilishidan oldin va yozilgandan keyin tekshiriladi.
- **Worker API (Task 2):** noma'lum klip id ham 409 `CLIP_NOT_CLAIMED` (recorder uchun bitta "to'xta" belgisi); klipni tirik tutadigan narsa — recorder har 10 soniyadan kechiktirmay yuboradigan `progress` (yuklash paytida ham), `heartbeat` klipga tegmaydi; demo fayli yo'q bo'lsa 410 `DEMO_NOT_AVAILABLE`; saqlagich ishlamasa 503 `STORAGE_UNAVAILABLE`; recorder nomi, versiyasi va rejimi faqat harf, raqam, `.`, `_`, `-` dan iborat, nom esa bir vaqtda ishlayotgan recorder'lar orasida yagona bo'lishi shart; rejalashtiruvchi ikki oqimda ishlaydi (uzoq tozalash eskirgan kliplar tekshiruvini to'sib qo'ymasligi uchun); Compose `CLIP_UPLOAD_MAX_SIZE` va `CLIP_RETENTION_CRON` ni ham uzatadi.
- **Media (Task 3):** bitta oraliqdan boshqa `Range` shakllari (bir necha oraliq, `bytes=-n`, boshqa birlik) e'tiborsiz qoldiriladi va to'liq fayl 200 bilan beriladi; fayl uzunligi qatordagi `size_bytes` dan emas, saqlagichdan olinadi; 416 javobi `RANGE_NOT_SATISFIABLE` kodli `ApiError` tanasi bilan keladi; yuklab olish nomi `<nickname>-<tur>-r<raund>.mp4` (tur kichik harfda, `_` o'rniga `-`; `NINJA_DEFUSE` — `defuse`); o'chirish avval qatorni, so'ng hamma urinishlarning fayllarini nomi bo'yicha olib tashlaydi; CORS'ga `DELETE` qo'shildi, shu sababli mavjud testlardan bitta parametrli holat olib tashlandi (backend testlari 255 → 254).
- **Recorder (Task 4):** soxta rejim o'zini real vaqtda yuritadi (`FAKE_SPEED`, standart 1; 0 — imkon qadar tez) — aks holda holatlar ketma-ketligini ham, yozish paytida o'ldirishni ham kuzatib bo'lmaydi; yuklash `node:http` orqali (`fetch` faylni to'liq xotiraga oladi); klip haqidagi istalgan so'rovga 409 kelsa, davom etayotgan yuklash ham darhol to'xtatiladi; `fail` bilan yuboriladigan matn ommaga ko'rinadi, shuning uchun qisqa sabab yoziladi (yo'llar va stack trace recorder'ning o'z logida qoladi); `ENCODING` va `UPLOADING` bosqichlari soxta rejimda soniyaning o'ndan bir necha ulushi davom etadi va sun'iy cho'zilmagan; qo'shimcha fayllar `log.ts` va `job.ts`; `Recorder.record` ga beshinchi parametr `signal: AbortSignal` qo'shilgan.
- **Kompilyatsiya (Task 7):** vaqtinchalik o'yinchi (`steam:<id>`) uchun ham so'rash mumkin (Task 7 matniga zid): id JSON tanasida keladi, highlight klipini bunday o'yinchi uchun so'rash allaqachon mumkin, soxta stack'da esa demodagi hamma o'yinchi vaqtinchalik. Kill'i bo'lmagan round kompilyatsiyaga hech narsa qo'shmaydi. Segment qoidasi hamma klip uchun bitta (kill'dan 3 s oldin, 2 s keyin); spec'ning csdemo.uz tavsifidagi "kompilyatsiyada 5 s / 3 s" bizning talab emas.
- **Frontend (Task 6–7):** "Klip yozish" tugmasi admin kalitisiz ham bosiladi — kalitni buyurtma dialogining o'zi so'raydi (Task 6 matnidagi "o'chirilgan tugma" o'rniga), chunki demo paneli kalitni faqat demo amali muvaffaqiyatli bo'lganda saqlaydi; klip kartasi — bitta havola, ichida tugma yo'q; ro'yxatlar "Yana ko'rsatish" bilan sahifalanadi (`useInfiniteQuery`); dialogda sifat yonida FPS yozilmaydi, standart sifat 1080p; `/clips` faqat tayyor kliplarni ko'rsatadi; o'yinchi va match sahifalaridagi "Kliplar" bo'limi klip bo'lgandagina chiqadi; kompilyatsiya panelidagi o'yinchilar — scoreboard'dagilar va faqat highlight'larda uchraydiganlar; qo'shimcha fayllar `ClipList`, `RecDot`, `ui/dialog`, `lib/clips.ts`, `lib/clipboard.ts`; `KillFeedRow` qurilmadi. Batafsil — dizayn spec'ining 3, 4 va 8-bo'limlarida.
- **Tekshiruvlardagi og'ishlar:** Task 1 (d) — haqiqiy demoda `NINJA_DEFUSE` yo'qligi uchun SQL bilan qo'yilgan qator ustida; Task 2 (f) — `clip.stale-after` bir marta rostdan kutildi, qolgan ikki davra `heartbeat_at` ni SQL bilan orqaga surib o'tkazildi; Task 3 (e) — Playwright orqali o'rnatilgan Chrome va WebKit'da (haqiqiy Safari va iOS da sinalmagan); Task 4 (b) — holat 25–200 ms oraliq bilan so'rab kuzatildi; Task 7 (c) — eng ko'p kill qilgan o'yinchining kompilyatsiyasi: 29 kill, 20 segment, 127,8 soniya, soxta recorder uni 128 soniyada yozdi.
- **Recorder xatodan keyin kutadi (Task 4, review'dan keyin):** xato bilan tugagan har ishdan keyin recorder yangi klip olmaydi — birinchi xatodan keyin `POLL_SECONDS`, ketma-ket har xatoda ikki barobar, ko'pi bilan `ERROR_BACKOFF_SECONDS` (standart sozlamada 5, 10, 20, 40, 80, 160, 300 soniya); yozib bo'lingan klip sanoqni boshiga qaytaradi, yo'qolgan da'vo va to'xtatish xato sanalmaydi. Review'gacha doimiy nosozlik (masalan, ffmpeg har safar yiqilsa) butun navbatni soniyalar ichida `FAILED` qilib chiqardi. Mashinaning o'z nosozligi (disk to'la, yozishga ruxsat yo'q, ffmpeg ishga tushmaydi) bitta joyda aniqlanadi (`recorder/src/machine.ts`): darhol `ERROR_BACKOFF_SECONDS` kutiladi, klipning xato sababi sifatida esa bitta qat'iy matn ketadi. Ishga tushishda `demos/*.part` qoldiqlari o'chiriladi, bo'sh keshlangan demo qayta yuklanadi; ffmpeg va ffprobe worker tokeni olib tashlangan muhitda ishga tushadi; soniya bilan beriladigan sozlamalar 86 400 dan oshmaydi. Qilinmagani: yozuvning o'ziga muddat (haqiqiy rejimda Task 5 ning o'z chegarasi bor), to'xtatish lahzasida javobi kelgan `claim` ni qaytarish, ish raqamlariga yuqori chegara, `complete` javob berguncha keep-alive.
- **Metrikalar (Task 8):** `clips_requested_total{kind}`, `clips_finished_total{status}`, `clips_requeued_total`, `clips_record_duration_seconds` (da'vodan tayyor bo'lguncha), `clips_queue_size`, `clips_active`, `clips_recorder_online`. Hisoblagich o'zgarishni qilgan tranzaksiya commit bo'lgandan keyin oshadi. Uchta gauge scrape paytida emas, har 10 soniyada o'qiladi (Task 8 matniga zid): baza ishlamay qolsa, scrape'ning o'zi ulanishni 30 soniya kutib, qolgan hamma metrikani ham yo'qotardi; o'qib bo'lmaganda gauge `NaN` bo'ladi. Saqlagich ishlamagani uchun qaytarilgan da'vo `clips_requeued_total` ga qo'shilmaydi — urinish bo'lmagan.
- **Interfeys, review'dan keyin (Task 6–7):** buyurtma dialogi so'rov ketayotganda yopilmaydi; sahifasi ochiq turgan klip o'chirilsa, sahifa "Klip topilmadi" deydi va so'rashni to'xtatadi; o'chirishni tasdiqlashda fokus savolga o'tadi va qaytadi; rad etilgan kalit, yuklanmagan video va nusxalanmagan havola o'z xabarini beradi; yozilayotgan klipning foizi ekran o'quvchisiga har so'rovda e'lon qilinmaydi; match sahifasidagi klip tugmalarining nomiga nimaniki ekani qo'shilgan; kliplar kelguncha kartada qator joyi saqlanadi. Batafsil — dizayn spec'ining 3 va 8-bo'limlarida. Qoldirilgani: yozuvchi o'chiq paytda ham ro'yxat har 3 soniyada so'raladi (reja qoidasi); kill belgilarining balandligi 24px (spec'dagi son).
