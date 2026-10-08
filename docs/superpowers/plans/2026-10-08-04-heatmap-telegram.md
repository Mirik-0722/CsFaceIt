# 4-quyi loyiha: Heatmap va Telegram Bot — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Darajasi:** spec interfeys darajasida (9, 10-bo'limlar). Ikki mustaqil qism: A — Heatmap (Task 1–4), B — Telegram bot (Task 5–7). Ular parallel bajarilishi mumkin. 2-reja (`heat_bins`, `kills` koordinatalari) va 3-reja (statistika, highlight'lar) tugagan bo'lishi kerak.

**Goal:** Xarita bo'yicha kill / death / movement heatmap radar rasmi ustida o'yinchi, xarita, tomon va sana filtrlari bilan ko'rinadi; Telegram bot `/faceit`, `/stats`, `/matches`, `/highlights` buyruqlariga backend servislar orqali javob beradi.

**Architecture:** `heatmap/` paketi `maps.json` dan xarita konfiguratsiyasini o'qiydi, `heat_bins` (dunyo koordinatasida 64 birlik katakcha) ni radar pikseliga (`(x - pos_x) / scale`, `(pos_y - y) / scale`) o'tkazib, piksel katakchalariga (`heatmap.cell-px=16`) qayta jamlaydi va `[{x, y, weight}]` qaytaradi. Frontend radar PNG ustiga `<canvas>` da chizadi. Bot — backend ichidagi `bot/` moduli (`telegrambots` kutubxonasi), buyruqlar `PlayerService`/`StatsService`/`HighlightService` ni to'g'ridan-to'g'ri chaqiradi; dev'da long polling, prod'da webhook (`bot.mode`).

**Tech Stack:** Spring Boot, Jackson (`maps.json`), Bucket4j (rate-limit), `org.telegram:telegrambots-springboot-longpolling-starter` / `telegrambots-webhook` 8.x; frontend: React canvas, shadcn `Select`, `DatePicker`.

**Spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (9, 10, 12-bo'limlar)

## Global Constraints

- Heatmap turlari aynan: `kill`, `death`, `movement`. Xaritalar: Dust2, Mirage, Inferno, Nuke, Ancient, Anubis, Train (`de_dust2, de_mirage, de_inferno, de_nuke, de_ancient, de_anubis, de_train`).
- Har xarita uchun `maps.json` da `{ "name", "radar": "/radars/de_mirage.png", "pos_x", "pos_y", "scale" }`; radar rasmlari `frontend/public/radars/` da (1024×1024). Nuke uchun ikki qavat MVP'da bitta rasmga yotqiziladi (`lower` bins ham ustiga chiziladi; qavatlarni ajratish kengaytma).
- Javob shakli aynan `[{x, y, weight}]`; filtrlar: `playerId`, `map`, `side` (`CT`/`T`), `from`, `to` (ISO sana).
- Bot buyruqlari aynan: `/faceit nickname`, `/stats nickname`, `/matches nickname`, `/highlights nickname`. Bot backend servislarni to'g'ridan-to'g'ri chaqiradi (HTTP emas). Token `TELEGRAM_BOT_TOKEN` muhit o'zgaruvchisida. Rate-limit foydalanuvchi boshiga daqiqasiga 20 so'rov.
- Bot'ga kirgan `nickname` 1-reja validatsiyasi (`^[A-Za-z0-9_-]{2,32}$`) bilan tekshiriladi.

## Review Focus

1. **Noma'lum xarita** (`?map=de_vertigo`): 500 emas, `400 VALIDATION_ERROR` yoki bo'sh ro'yxat — qaror: 400 (Task 2, `unknownMapReturns400`).
2. **Ma'lumotsiz filtr** (o'yinchi bu xaritada o'ynamagan): `[]` va 200 (Task 2, `noDataReturnsEmptyArray`).
3. **Radar chegarasidan chiqqan nuqtalar** (xarita tashqarisidagi pozitsiyalar): tashlab yuboriladi, `x,y` manfiy yoki > 1024 bo'lmaydi (Task 1, `outOfBoundsPointsAreDropped`).
4. **Bot: nickname'siz buyruq** (`/stats`): yordam matni, istisno yo'q (Task 5, `statsWithoutNicknameRepliesUsage`).
5. **Bot: FACEIT ishlamayapti** (502): foydalanuvchiga "FACEIT temporarily unavailable, try later" xabari (Task 6, `faceitOutageRepliesFriendlyMessage`).

---

## Fayl tuzilmasi

```
backend/src/main/java/io/csfaceit/backend/
├── heatmap/MapConfig.java, MapRegistry.java, RadarTransform.java, HeatmapService.java,
│   HeatmapController.java, dto/HeatPoint.java, dto/HeatmapQuery.java
├── resources/maps.json
└── bot/BotProperties.java, BotConfig.java, FaceitBot.java (long polling), FaceitWebhookBot.java,
    CommandRouter.java, commands/{FaceitCommand,StatsCommand,MatchesCommand,HighlightsCommand}.java,
    MessageFormatter.java, UserRateLimiter.java
frontend/public/radars/*.png
frontend/src/pages/HeatmapPage.tsx, components/HeatmapCanvas.tsx, components/HeatmapFilters.tsx
```

---

## A qism — Heatmap

### Task 1: `maps.json`, `MapRegistry`, `RadarTransform`

**Interfaces:**
- `record MapConfig(String name, String radar, double posX, double posY, double scale, int sizePx)`; `MapRegistry.get(String name) -> Optional<MapConfig>`, `all()`; `maps.json` classpath'dan yuklanadi (`@PostConstruct`). 7 xarita uchun `pos_x/pos_y/scale` qiymatlari CS2 `*.txt` radar overview fayllaridan olinadi va `maps.json` ga yoziladi (masalan Mirage: `pos_x=-3230, pos_y=1713, scale=5.0`).
- `RadarTransform.toPixel(MapConfig m, double worldX, double worldY) -> Optional<PixelPoint(int x, int y)>` — `x = (worldX - posX) / scale`, `y = (posY - worldY) / scale`; `0 ≤ x,y < sizePx` bo'lmasa `empty`.
- `RadarTransform.binToPixelCell(MapConfig m, int binX, int binY, int worldBinSize, int cellPx) -> Optional<PixelPoint>` — bin markazi (`binX*64+32`) pikselga o'tkazilib `cellPx` ga bo'linadi.

- [ ] Step 1: Testlar `allSevenMapsLoaded`, `mirageOriginMapsToExpectedPixel` (ma'lum koordinata → kutilgan piksel ±1), `outOfBoundsPointsAreDropped`.
- [ ] Step 2–5: TDD; Commit `feat(heatmap): add map registry and radar coordinate transform`.

### Task 2: `HeatmapService` va `GET /api/v1/heatmap`

**Interfaces:**
- `record HeatmapQuery(String playerId /*faceit*/, String map, HeatKind kind, Side side /*nullable*/, LocalDate from, LocalDate to)`; `enum HeatKind { KILL, DEATH, MOVEMENT }`.
- `HeatmapService.compute(HeatmapQuery) -> List<HeatPoint(int x, int y, int weight)>` — `heat_bins JOIN matches` (map_name, started_at oralig'i) → bin bo'yicha `SUM(count)` → `RadarTransform.binToPixelCell` → piksel katakchalariga qayta jamlash (`HashMap<PixelPoint, Integer>`), `weight` ≥ 1.
- `GET /api/v1/heatmap?playerId=&map=&kind=kill&side=CT&from=2026-09-01&to=2026-10-08` → `[{x,y,weight}]`; `map` `MapRegistry` da yo'q → 400 `VALIDATION_ERROR`; `kind` noto'g'ri → 400. Javob `Cache-Control: max-age=300`.
- `GET /api/v1/maps` → `MapConfig[]` (frontend radar yo'lini va o'lchamni shundan oladi).

- [ ] Step 1: Integratsion testlar (sintetik `heat_bins` qatorlari) — `aggregatesBinsIntoPixelCells` (ikki qo'shni bin bir katakchaga → weight 2), `filtersBySideAndDateRange`, `noDataReturnsEmptyArray`, `unknownMapReturns400`, `mapsEndpointListsSeven`.
- [ ] Step 2–5: TDD; Commit `feat(heatmap): add heatmap aggregation endpoint and maps listing`.

### Task 3: `kills` → `heat_bins` (kill/death) to'ldirish tekshiruvi

2-reja parseri `heat_bins` ni `kill/death/movement` uchun yozadi. Bu vazifa faqat 2-reja T5 `bins::aggregate` chiqishi `side` ni to'g'ri yozganini va `movement` har 32 tickda tanlanganini golden-test bilan tasdiqlaydi (Modify: `parser/tests/golden.rs` — `heat_bins_have_all_three_kinds_and_sides`). Agar yo'q bo'lsa, parser tuzatiladi. Commit `test(parser): assert heat bins cover kill/death/movement per side`.

### Task 4: Frontend — `HeatmapPage`

**Interfaces:**
- `useMaps()`, `useHeatmap(query)` hook'lari (`api/queries.ts`); `HeatmapFilters({ value, onChange })` — xarita `Select` (`/api/v1/maps`), tur (`kill|death|movement`), tomon (`All|CT|T`), sana oralig'i; `HeatmapCanvas({ radarUrl, sizePx, points, cellPx })` — radar `<img>` ustida `<canvas>`, har nuqta `weight` ga ko'ra alfa (`min(1, weight / maxWeight)`) bilan `cellPx` kvadrat, rang gradient (kill qizil, death ko'k, movement sariq).
- Marshrut `/players/:playerId/heatmap`; `PlayerPage` da "Heatmap" tab.
- Testlar: `HeatmapCanvas.test.tsx` (canvas `fillRect` nuqtalar soniga teng chaqiriladi — `vi.spyOn(CanvasRenderingContext2D.prototype, 'fillRect')`), `HeatmapFilters.test.tsx` (xarita tanlanganda `onChange` `map` bilan chaqiriladi).
- Commit `feat(frontend): add heatmap page with radar canvas and filters`.

---

## B qism — Telegram bot

### Task 5: Bot skeleti, `CommandRouter`, `/faceit`

**Interfaces:**
- `BotProperties(String token, String username, Mode mode /*POLLING|WEBHOOK*/, String webhookUrl, int rateLimitPerMinute=20)`; `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_MODE`, `TELEGRAM_WEBHOOK_URL`. Token bo'sh bo'lsa bot bean'lari yaratilmaydi (`@ConditionalOnProperty("bot.token")`) — backend botsiz ham ishlaydi.
- `CommandRouter.handle(long chatId, long userId, String text) -> String` — `/cmd arg` ni ajratadi, `UserRateLimiter.tryConsume(userId)` (Bucket4j, 20/min) rad etsa `"Too many requests, wait a minute."`; noma'lum buyruq → yordam; `nickname` validatsiyasi; `NotFoundException` → `"Player not found: {nickname}"`; `FaceitUnavailableException` → `"FACEIT is temporarily unavailable, try again later."`.
- `interface BotCommand { String name(); String execute(String nickname); }`; `FaceitCommand` → `PlayerService.findByNickname` → `MessageFormatter.profile(PlayerResponse)`: `"🎮 s1mple\nLevel 10 · ELO 3500\nCountry: UA"`.
- `FaceitBot` (long polling): `Update` → `CommandRouter` → `sendMessage(chatId, text, parseMode=null)`.

- [ ] Step 1: Birlik testlar (Mockito, Telegram API'siz) — `faceitCommandFormatsProfile`, `statsWithoutNicknameRepliesUsage` (`/stats` → `"Usage: /stats <nickname>"`), `invalidNicknameRepliesValidationMessage`, `unknownCommandRepliesHelp`, `rateLimiterBlocksTwentyFirstRequestInMinute`.
- [ ] Step 2–5: TDD; Commit `feat(bot): add Telegram bot skeleton with command router, rate limit and /faceit`.

### Task 6: `/stats`, `/matches`, `/highlights`

**Interfaces:**
- `StatsCommand` → `PlayerService.findByNickname` + `StatsService.aggregate(playerId)` (3-reja T6) → `"📊 s1mple — 42 matches\nK/D 1.21 · HS 48% · ADR 81.3\nKAST 72% · Clutch 35% · Win rate 56%"`.
- `MatchesCommand` → `PlayerService.getHistory(playerId, 0, 5)` → 5 qator `"✅ 13:9 · de_mirage · 2 Oct"` / `"❌ ..."` (map `matches` jadvalidan, yo'q bo'lsa `?`).
- `HighlightsCommand` → `HighlightService.latestForPlayer(playerId, 5)` → `"🔥 ACE · round 7 · de_inferno · 1 Oct"`; bo'sh → `"No highlights yet. Import a demo first."`.
- Testlar — `statsCommandFormatsPercentages`, `matchesCommandShowsFiveWithResultIcons`, `highlightsEmptyMessage`, `faceitOutageRepliesFriendlyMessage`.
- Commit `feat(bot): add /stats, /matches and /highlights commands`.

### Task 7: Webhook rejimi va Compose

- `FaceitWebhookBot`: `POST /telegram/webhook/{secretPath}` (`bot.webhook-secret`), Spring Security'da `permitAll` lekin secret path tekshiruvi; `bot.mode=WEBHOOK` da start'da `setWebhook` chaqiriladi. Nginx `location /telegram/` → backend.
- Compose: `.env.example` ga `TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_MODE=POLLING, TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET`.
- Testlar: `webhookWithWrongSecretIs404`, `webhookDispatchesUpdateToRouter` (MockMvc, router mock).
- Qo'lda tekshirish: dev'da `TELEGRAM_BOT_MODE=POLLING` bilan `/faceit s1mple` → javob keladi.
- Commit `feat(bot): add webhook mode and deployment wiring`.

---

## O'z-o'zini tekshirish

- Spec 9: turlar, 7 xarita, `maps.json` (`pos_x, pos_y, scale`), dunyo→radar transformatsiya, `[{x,y,weight}]`, 4 filtr (T1, T2, T4). Spec 10: 4 buyruq (T5, T6), to'g'ridan-to'g'ri servis chaqiruvi (T5), polling/webhook (T5, T7), token env (T5), 20/min (T5). Spec 12: nickname validatsiyasi bot'da (T5).
- Nomlar: `StatsService.aggregate`, `HighlightService.latestForPlayer` 3-rejada mavjud bo'lishi kerak — 3-reja T6 da `aggregate` bor; `latestForPlayer` 3-reja T6 player highlights so'roviga mos (`limit=5, offset=0`).
