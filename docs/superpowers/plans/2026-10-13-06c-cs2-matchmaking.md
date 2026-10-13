# 6c-quyi loyiha: CS2 matchmaking manba sifatida — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kirgan o'yinchi bir marta CS2'ning "authentication code" va oxirgi "match sharing code" ini beradi; shundan keyin Valve matchmaking'idagi (Premier, Competitive, Wingman) har yangi matchining demosi o'zi olinadi, tahlil qilinadi va FACEIT matchlari bilan bitta ro'yxatda ko'rinadi.

**Architecture:** Matchmaking matchida FACEIT ma'lumoti umuman yo'q, shuning uchun match endi o'z demosining o'zidan mavjud bo'la oladi: `matches.source`, tashqi identifikator `mm-<Valve match id>`, jamoalar — birinchi raunddagi tomonlar, hisob — raundlardan, o'yinchilar — SteamID bo'yicha (`steam:<id>`). Zanjir yuruvchi (`cs2/Cs2ChainJob`) Steam Web API'ning `GetNextMatchSharingCode` chaqirig'i bilan keyingi kodlarni topadi; kodni demo manziliga faqat o'yin koordinatori aylantira oladi, buni alohida kichik xizmat — `gcbridge/` (Steam bot hisobi bilan) — qiladi. Demo manzili 6b-rejaning `LinkGuard` i orqali olinadi; `.dem.bz2` backend'da ochiladi, parser o'zgarmaydi.

**Tech Stack:** Spring Boot 3.5, Flyway `V9`, Apache `commons-compress` (bzip2); Node 22 (`steam-user`, `globaloffensive`) — faqat `gcbridge/` da; WireMock (soxta Steam Web API va soxta ko'prik); React 19.

**Spec:** `docs/superpowers/specs/2026-10-11-csdemo-uz-alternative-design.md` (42- va 101-qatorlar: "Steam Premier/Competitive (authentication code + share code zanjiri)", "o'yin koordinatoriga ulangan Steam bot"); foydalanuvchi talabi (2026-10-13): "faceit va cs2 dan demo olib uni ko'rsatishni tezlashtirish kerak". 6b-reja (`2026-10-13-06b-fast-demos.md`) tugagan bo'lishi shart: `Actor`/`Access`, `LinkGuard`, `PastedLinks`, cheklovlar, noto'g'ri demo tekshiruvi shundan olinadi.

## Global Constraints

- Yangi test yozilmaydi; mavjud to'plamlar yashil qoladi. Tekshiruv — soxta stack: WireMock Steam Web API'ni ham, ko'prikni ham o'ynaydi; haqiqiy ko'prik Compose profili ortida va standart holda ishga tushmaydi.
- `V1`–`V8` tahrirlanmaydi; bu rejaning sxemasi bitta faylda: `V9__match_source.sql`.
- `matches.faceit_match_id` ustuni qayta nomlanmaydi: u ommaviy identifikator bo'lib qoladi (`mm-<Valve match id>` ham shu yerda); parser o'zgarmaydi.
- Authentication code — sir: bazada AES-256-GCM bilan (har qatorga tasodifiy nonce, kalit `CS2_LINK_SECRET`), faqat zanjir yuruvchi ichida ochiladi, hech bir endpoint qaytarmaydi, logga tushmaydi (Steam uni so'rov satrida oladi — klient xatoda faqat istisno klassining nomini saqlaydi). Bot hisobining ma'lumotlari faqat `gcbridge` da.
- Hech bir sozlama berilmagan bo'lsa (`STEAM_WEB_API_KEY`, `CS2_BRIDGE_URL`, `CS2_LINK_SECRET`) butun imkoniyat o'chiq: endpointlar 404 `CS2_DISABLED`, ishlar hech narsa qilmaydi, sahifada ulash bo'limi ko'rinmaydi.
- Bitta o'yinchi — bitta profil: FACEIT va matchmaking matchlari profil statistikasida birga; qatorlarda manba tegi.
- 6b-rejaning cheklovlari (kod, matn, sir, ikki til, rasm qoidasi, foydalanuvchi stekiga tegmaslik) to'liq amal qiladi.

## Review Focus

1. **Authentication code'ning yo'li.** Kiritilgan paytdan bazagacha va Steam'ga so'rovgacha u hech bir logda, xato matnida, navbat xabarida yoki javobda ko'rinmaydi; `CS2_LINK_SECRET` almashsa eski qatorlar tushunarli holatga o'tadi (yiqilmaydi).
2. **Noto'g'ri yoki eskirgan kodlar.** Authentication code rad etilsa (403) yoki ma'lum kod shu hisobniki bo'lmasa (412), bog'lanish tushunarli holatga o'tadi va tashrifchi nima qilishni o'qiydi; zanjir cheksiz qayta urinmaydi; 429 butun yurishni to'xtatadi.
3. **Demo hali tayyor emas yoki muddati o'tgan.** Ko'prik "hali yo'q" desa match kutadi va keyinroq so'raladi; "muddati o'tgan" desa match xato kodi bilan qoladi va qayta so'ralmaydi; ko'prik umuman ishlamasa hech narsa yo'qolmaydi.
4. **FACEIT'siz match sahifalari.** `mm-` match, uning statistikasi, raundlari, highlight'lari, klip buyurtmasi va `steam:<id>` o'yinchi sahifasi FACEIT'ga birorta so'rovsiz ochiladi; FACEIT'ga xos belgi va havolalar bunday matchda chiqmaydi.
5. **Bitta odam — ikki qator.** FACEIT bog'langan o'yinchining matchmaking kill'lari alohida `steam:` qatoriga tushib qolmaydi; boshqa birovning matchi (egasi demoda yo'q) `WRONG_MATCH` bilan tugaydi.

---

## Shartnoma

**Sxema (`V9__match_source.sql`):** `matches.source VARCHAR(16) NOT NULL DEFAULT 'FACEIT'` (`FACEIT`, `MATCHMAKING`), `matches.share_code`, `matches.owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL`; `cs2_links (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, auth_code BYTEA NOT NULL, last_share_code VARCHAR(64) NOT NULL, state VARCHAR(16) NOT NULL, failures INT NOT NULL DEFAULT 0, next_check_at TIMESTAMPTZ, checked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`; `state`: `ACTIVE`, `BAD_AUTH_CODE`, `BAD_SHARE_CODE`.

**Backend:** `match/MatchSource`; match javoblarida va "Matchlar" qatorlarida `source`; `GET /api/v1/players/{playerId}/matches` ga ixtiyoriy `before` (sahifadagi oxirgi qatorning boshlanish vaqti) — javobga shu oraliqdagi matchmaking matchlari qo'shiladi; `playerId` sifatida `steam:<raqamlar>` qabul qilinadi (baza endpointlari). Demo nomi: `<Valve match id>_<n>.dem.bz2` → `mm-<Valve match id>`; match birinchi yuklash yoki havolada yaratiladi. Noto'g'ri demo qoidasi: egasining SteamID'si demodagi o'yinchilar orasida.

**Ulash endpointlari:** `POST /api/v1/cs2/link` `{authCode, shareCode}` (bitta Steam chaqirig'i bilan tekshiriladi; 422 `CS2_AUTH_CODE_REFUSED` yoki `CS2_SHARE_CODE_REFUSED`), `GET /api/v1/cs2/link` → `{state, linkedAt, checkedAt}`, `DELETE /api/v1/cs2/link`.

**Zanjir yuruvchi (`cs2/Cs2ChainJob`):** har `cs2.sync.interval` (2m), ko'pi bilan `links-per-run` (5) ta bog'lanish va `steps-per-link` (5) qadam, soniyasiga bitta Steam chaqirig'i. Steam javoblari: 200 va kod — yangi match (ko'prikdan so'raladi, match saqlanadi, import navbatga qo'yiladi, kod "ma'lum" bo'ladi, davom etadi); 202 `n/a` — hozircha yo'q (`idle-recheck` 15m dan keyin); 403 — `BAD_AUTH_CODE`; 412 — `BAD_SHARE_CODE`; 429 — butun yurish tugaydi; 5xx yoki timeout — kutish ikki barobar ortib boradi (1 soatgacha).

**Ko'prik (`gcbridge/`, sarlavha `X-Bridge-Token`):** `GET /health` → 200 `{steam, gc}` yoki 503; `POST /resolve` `{shareCode}` → 200 `{matchId, replayUrl, matchTime}`; 409 `REPLAY_NOT_READY` (`matchTime` bilan; 2 soat davomida har 5 daqiqada qayta so'raladi); 410 `REPLAY_EXPIRED` (match shu kod bilan `FAILED`, qayta so'ralmaydi); 404 `MATCH_UNKNOWN`; 429 `BUSY`; 503 `GC_UNAVAILABLE`.

**Sozlamalar:** `STEAM_WEB_API_KEY`, `CS2_STEAM_API_URL` (standart Steam'ning o'zi), `CS2_BRIDGE_URL`, `CS2_BRIDGE_TOKEN`, `CS2_LINK_SECRET`, `cs2.sync.*`; ko'prik uchun `STEAM_BOT_USERNAME`, `STEAM_BOT_PASSWORD`, `STEAM_BOT_SHARED_SECRET` (yoki bir martalik kirish bilan olingan refresh token). `DEMO_LINK_ALLOWED_ORIGINS` ga `http://replay*.valve.net` qo'shiladi.

**Foydalanuvchidan (haqiqiy ishlashi uchun):** Steam Web API kaliti; CS2 kutubxonasida bo'lgan alohida Steam hisobi (bot). Bot — Steam'dan norasmiy foydalanish, Valve uni cheklashi mumkin.

---

## Vazifalar

### Task C1: Match o'z demosining o'zidan

**Files:** `db/migration/V9__match_source.sql`, `match/Match`, `MatchService`, yangi `match/DemoScoreboard`, `auth/Access`, `analysis/RosterCheck`, o'yinchi controller'lari, `player/PlayerService`, `auth/SignInService`, `player/PlayerOverviewService`; README.

**Interfaces:** Consumes 6b (`Access`, `RosterCheck`). Produces `MatchSource`, `source` qatorlarda, `before`, `steam:<id>` o'yinchi yo'llari; kirishda bog'langan o'yinchiga tashrifchining SteamID'si yoziladi.

- [ ] `mm-` match uchun `MatchResponse` bazadan: xarita va vaqt, jamoalar — birinchi raund tomonlari (`faction1` CT'dan boshlagan, `faction2` T'dan), parse'gacha bo'sh; statistika — tahlil qatorlari boshlang'ich tomon bo'yicha; hisob — raund g'oliblaridan.
- [ ] Tekshiruv: to'plam; soxta stack'da tahlil qilingan lokal demo ustiga psql bilan qo'yilgan `mm-` match — match, statistika, breakdown, highlight'lar, klip buyurtmasi va `/players/steam:<id>` FACEIT'siz javob beradi.

### Task C2: bz2 va Valve nomlari

**Files:** `demo/DemoFiles`, `backend/pom.xml`, `demo/DemoController`, `demo/DemoFileName`, `demo/DemoService`, `messaging/DemoImportWorker`, `application.yml`; frontend'da qabul qilinadigan kengaytmalar.

**Interfaces:** Consumes C1. Produces `.dem.bz2` qabul qilinishi (`BZh` tarmog'i), `mm-<matchid>` ni nomdan topish, matchni birinchi yuklash yoki havolada yaratish.

- [ ] Tekshiruv: to'plam; lokal demoning `.dem.bz2` nusxasini yuklash va havola bilan berish — `PARSED`; egasi yo'q demo `WRONG_MATCH`.

### Task C3: Ulash va zanjir yuruvchi

**Files:** yangi `cs2/*` (`Cs2LinkController`, `Cs2LinkService`, `Cs2Links`, `AuthCodeCipher`, `SteamShareCodeClient`, `BridgeClient`, `Cs2ChainJob`, `Cs2Properties`); `config/SecurityConfig`, `application.yml`, ikkala Compose fayli, WireMock stub'lari; README, `.env.example`.

**Interfaces:** Consumes C1, C2. Produces ulash endpointlari, `Cs2ChainJob`, `cs2.*`.

- [ ] Tekshiruv: to'plam; soxta stack'da A kodi bilan ulash ikki matchni olib keladi; 403 va 412 stub'lari ikki yomon holatni qo'yadi; 409 qayta so'raladi, 410 o'z kodi bilan tugaydi; bazada va loglarda o'qiladigan kod yo'q.

### Task C4: Ko'prik (hamma narsa bilan parallel)

**Files:** faqat `gcbridge/**` (xizmat, `Dockerfile`, README, bir martalik kirish yordamchisi), Compose'dagi profil.

**Interfaces:** Produces yuqoridagi HTTP interfeysi va soxta rejim (`BRIDGE_FAKE=1`: Steam'ga ulanmasdan belgilangan javoblar).

- [ ] Tekshiruv: soxta rejimga curl (har javob kodi); image quriladi; haqiqiy `resolve` — bot hisobi berilgach, foydalanuvchi bilan birga.

### Task C5: Sahifalar

**Files:** "Matchlar" dagi ulash bo'limi, manba teglari, match va o'yinchi sahifalari, lug'atlar; dizayn hujjatining yangi qatorlari (avval hujjat, keyin kod).

**Interfaces:** Consumes C1–C3.

- [ ] Ulash bo'limi: ikki maydon, Steam'ning kodlar sahifasiga havola, holat (`ACTIVE` va ikki yomon holatning tushunarli matni), uzish. Matchmaking qatorida FACEIT tegi o'rnida manba tegi, FACEIT xonasiga havola yo'q.
- [ ] Tekshiruv: to'plamlar; soxta stack'da butun oqim brauzerda; 1440 va 390 px rasmlar.

---

## Bajarish tartibi

C4 istalgan payt (boshqa hech narsaga tegmaydi). C1 → C2 → C3; C5 — C2–C3 bilan parallel, C1 dan keyin.
