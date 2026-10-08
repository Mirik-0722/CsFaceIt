# CS2 FACEIT Analyzer va Highlight Platformasi — Dizayn Spec

**Sana:** 2026-10-08
**Holat:** Qoralama, foydalanuvchi ko'rib chiqishini kutmoqda
**Yo'l:** Arxitektura (yangi loyiha, bir nechta mustaqil quyi tizim)

## 1. Maqsad

FACEIT o'yinchilari va CS2 demo fayllarini avtomatik tahlil qilish: o'yinchi statistikasini ko'rsatish, ACE / Clutch / Multi-kill kabi muhim voqealarni aniqlash, heatmap qurish va keyinchalik highlight videolar yaratish.

**Muvaffaqiyat mezonlari (MVP):**
1. Nickname kiritilganda ELO, FACEIT Level, oxirgi matchlar va match statistikasi 2 soniyadan kam vaqtda (keshdan) chiqadi.
2. Tanlangan matchning demo'si avtomatik yuklanadi, parse qilinadi va highlight'lar ro'yxati (ACE, 4K, 3K, clutch, special) olinadi.
3. O'yinchi uchun K/D, HS%, ADR, KAST, Entry, Trade, Clutch %, Win Rate hisoblanadi.
4. Xarita bo'yicha kill / death / movement heatmap ko'rinadi.
5. Telegram bot `/faceit`, `/stats`, `/matches`, `/highlights` buyruqlariga javob beradi.

**Maqsadli foydalanuvchi:** hozir shaxsiy / kichik jamoa uchun; keyin tijoratga o'tishi mumkin. Shu sababli sxema va auth ommaviy foydalanishga o'tishni to'smaydi, lekin MVP'da multi-tenant, billing va murakkab rate-limit qurilmaydi.

## 2. Scope

**MVP ichida:** FACEIT integratsiyasi, demo import, demo parsing, highlight detection, statistika, heatmap, Telegram bot, web frontend.

**MVP tashqarisida (keyingi bosqichlar):** video rendering (CS2 renderer, render queue, MP4), AI highlight ranking, foydalanuvchi hisoblari va to'lovlar.

## 3. Quyi loyihalar (dekompozitsiya)

Har biri o'z spec → reja → implementatsiya siklidan o'tadi.

| # | Quyi loyiha | Hafta | Natija |
|---|-------------|-------|--------|
| 1 | FACEIT Analytics | 1 | API integratsiya, PostgreSQL sxema, backend, frontend qidiruv/profil/matchlar |
| 2 | Demo pipeline | 2 | Demo yuklash, MinIO, RabbitMQ, Rust parser worker, parse natijalarini DBga yozish |
| 3 | Highlights va statistika | 3 | Highlight detektorlar, statistika hisoblash, UI |
| 4 | Heatmap va Telegram bot | 4 | Heatmap hisoblash/ko'rsatish, bot buyruqlari |
| 5 | Video rendering | keyin | Render queue, renderer, MP4 saqlash |
| 6 | AI ranking | keyin | Highlight'larni baholash |

Bu spec 1–4 ni arxitektura darajasida belgilaydi; 1-quyi loyiha batafsil, 2–4 interfeyslar darajasida. 5–6 faqat kengaytma nuqtalari bilan.

## 4. Arxitektura

```
Frontend (React)        Telegram Bot
        \                    /
         Nginx / API Gateway
                 |
        Spring Boot Backend ---- Redis (kesh)
          |            |
     PostgreSQL     RabbitMQ
          |            |
        MinIO <-- Rust Parser Workers
```

**Asosiy qaror:** backend va parser faqat RabbitMQ va umumiy saqlash (MinIO + PostgreSQL) orqali bog'lanadi. Parser backend kodiga bog'liq emas, mustaqil masshtablanadi va alohida tilda yoziladi.

### Komponentlar

| Komponent | Vazifasi | Bog'liqlik |
|-----------|----------|------------|
| `backend` (Spring Boot 3.5, Java 21) | REST API, FACEIT klient, orkestratsiya, highlight va statistika hisoblash, bot webhook/polling | PostgreSQL, Redis, RabbitMQ, MinIO |
| `parser` (Rust, Tokio, demoparser2) | Demo faylni o'qib, xom hodisalarni (kill, damage, round, position) ajratadi | RabbitMQ, MinIO, PostgreSQL |
| `frontend` (React, TS, Vite, Tailwind, shadcn/ui, Recharts, TanStack Query) | Qidiruv, profil, match, highlight, heatmap sahifalari | backend REST |
| `bot` (backend ichidagi modul) | Telegram buyruqlari | backend servislar |
| Infratuzilma | PostgreSQL 17, Redis 8, RabbitMQ, MinIO, Nginx, Prometheus/Grafana/Loki/OTel | Docker Compose |

**Hisoblash chegarasi:** parser faqat *faktlarni* (kill, damage, round chegaralari, pozitsiyalar) chiqaradi. Highlight va statistika *talqini* backend'da yashaydi. Shu tufayli detektor qoidalari parserni qayta yig'masdan o'zgartiriladi va xom faktlardan qayta hisoblanadi.

## 5. FACEIT integratsiyasi (1-quyi loyiha)

Tashqi API: FACEIT Data API v4 (`https://open.faceit.com/data/v4`), `Authorization: Bearer <API_KEY>`. Kalit muhit o'zgaruvchisida (`FACEIT_API_KEY`), kodga yozilmaydi.

| Backend ichki endpoint | FACEIT chaqiruvi | Izoh |
|------------------------|------------------|------|
| `GET /api/v1/players?nickname=` | `GET /players?nickname=` | Nickname bo'yicha o'yinchini topadi, `players` jadvalini yangilaydi |
| `GET /api/v1/players/{playerId}` | `GET /players/{player_id}` | ELO (`games.cs2.faceit_elo`), Level (`skill_level`) |
| `GET /api/v1/players/{playerId}/history` | `GET /players/{player_id}/history?game=cs2` | Oxirgi matchlar, `offset`/`limit` bilan |
| `GET /api/v1/matches/{matchId}` | `GET /matches/{match_id}` | Match tafsilotlari, demo URL |
| `GET /api/v1/matches/{matchId}/stats` | `GET /matches/{match_id}/stats` | Match statistikasi |

**Kesh (Redis):** o'yinchi profili 5 daqiqa, history 2 daqiqa, tugagan match tafsilotlari/statistikasi 24 soat (o'zgarmaydi). Kesh kaliti: `faceit:{resurs}:{id}`.

**Xatolar:** FACEIT 404 → bizning 404 (`PLAYER_NOT_FOUND`). 429 yoki 5xx → eksponensial kechikish bilan 3 martagacha qayta urinish, so'ng 502 va keshdagi eskirgan ma'lumot bo'lsa o'shani qaytarish. Timeout: 5 s ulanish, 10 s o'qish.

**Xavf (2-quyi loyihada tasdiqlanadi):** demo faylni yuklab olish FACEIT'ning alohida Downloads API ruxsatini va ishlaydigan `demo_url` ni talab qilishi mumkin. 2-quyi loyiha boshida shu ruxsat amalda tekshiriladi; bo'lmasa zaxira: foydalanuvchi `.dem` faylni qo'lda yuklaydi (shu uchun upload endpoint ham ko'zda tutiladi).

## 6. Demo pipeline (2-quyi loyiha, interfeys darajasida)

```
POST /api/v1/matches/{id}/demo/import
  -> demos(status=QUEUED) yaratiladi
  -> RabbitMQ: demo.import
Import worker: URL dan yuklaydi -> MinIO (demos/{match_id}.dem.zst yoki .dem) -> status=STORED
  -> RabbitMQ: demo.parse
Parser worker: MinIO dan o'qiydi -> demoparser2 -> PostgreSQL (xom jadvallar) -> status=PARSED
  -> RabbitMQ: demo.parsed
Backend: highlight va statistikani hisoblaydi -> status=ANALYZED
```

- **Saqlash:** `StorageService` interfeysi, ikki implementatsiya: `LocalStorage` (dev) va `MinioStorage` (S3-mos). Tanlash `storage.type` konfiguratsiyasi bilan.
- **Idempotentlik:** `demos.faceit_match_id` UNIQUE. Qayta import mavjud yozuvni qayta ishlatadi; qayta parse oldingi xom ma'lumotni `demo_id` bo'yicha o'chirib yozadi.
- **Xabar kafolati:** at-least-once; consumer'lar idempotent. Muvaffaqiyatsiz xabar 3 urinishdan so'ng DLQ'ga tushadi, `demos.status=FAILED` va `error` matni saqlanadi.
- **Parser chiqaradigan faktlar:** match, round, player, kill (killer, victim, weapon, headshot, wallbang, noscope, thrusmoke, attacker_blind, tick), assist, damage, grenade, pozitsiya (tanlangan tick oralig'ida).
- **Tick tezligi** demo sarlavhasidan o'qiladi, qattiq kodlanmaydi.
- **Pozitsiya saqlash:** har tick pozitsiyasi saqlanmaydi (hajm katta). Heatmap uchun pozitsiyalar tanlab olinadi (masalan, har 32 tickda bir marta) va xarita bo'yicha katakchalarga (bin) jamlanadi.

## 7. Highlight detection (3-quyi loyiha, interfeys darajasida)

Detektorlar xom faktlar ustida ishlaydi va `highlights` jadvaliga yozadi (`type`, `round_number`, `tick_start`, `tick_end`, `player_id`).

| Tur | Qoida |
|-----|-------|
| `ACE` | Bir o'yinchi bir roundda 5 kill |
| `K4`, `K3` | Bir roundda aynan 4 yoki 3 kill (yuqori tur mavjud bo'lsa pastkisi yozilmaydi) |
| `CLUTCH_1V1..1V5` | O'yinchi jamoasida yagona tirik, raqibda N tirik; **faqat roundni yutganda** yoziladi (yutqazilgan holat statistikada urinish sifatida hisoblanadi) |
| `NO_SCOPE` | Snayper (AWP, SSG 08, G3SG1, SCAR-20) bilan noscope kill |
| `KNIFE_KILL` | Pichoq bilan kill |
| `WALLBANG` | Penetratsiya bilan kill |
| `SMOKE_KILL` | Smoke ichidan/orqali kill |
| `NINJA_DEFUSE` | Defuse tugaganda raqibning kamida bitta tirik o'yinchisi bor va defuse boshlanishida u yaqin atrofda emas. Evristika; chegara qiymatlari konfiguratsiyada |

`tick_start`/`tick_end`: voqea boshlanishidan oldin ~3 s va keyin ~2 s (konfiguratsiyada), tick tezligiga qarab hisoblanadi.

## 8. Statistika (3-quyi loyiha)

| Ko'rsatkich | Formula |
|-------------|---------|
| K/D | kills / max(deaths, 1) |
| HS% | headshot kills / kills |
| ADR | har round uchun, har raqib bo'yicha 100 bilan cheklangan zarar yig'indisi / roundlar soni |
| KAST | Kill, Assist, Survive yoki Trade bo'lgan roundlar ulushi |
| Entry Frag | jamoada roundning birinchi kill'i |
| Trade Kill | jamoadoshi o'limidan 5 s ichida uning qotilini o'ldirish |
| Clutch % | yutilgan clutch / clutch urinishlari |
| Win Rate | yutilgan matchlar / jami matchlar |

## 9. Heatmap (4-quyi loyiha)

Turlar: kill, death, movement. Xaritalar: Dust2, Mirage, Inferno, Nuke, Ancient, Anubis, Train.

- Har xarita uchun radar rasmi va koordinata transformatsiyasi (`pos_x`, `pos_y`, `scale`) konfiguratsiya fayli `maps.json` da.
- Backend dunyo koordinatalarini radar piksellariga o'tkazib, katakchalarga jamlaydi va `[{x, y, weight}]` ro'yxatini qaytaradi; frontend uni radar ustiga chizadi.
- Filtrlar: o'yinchi, xarita, tomon (CT/T), sana oralig'i.

## 10. Telegram bot (4-quyi loyiha)

Buyruqlar: `/faceit nickname`, `/stats nickname`, `/matches nickname`, `/highlights nickname`. Bot backend servislarni to'g'ridan-to'g'ri chaqiradi (HTTP orqali emas). Dev'da long polling, prod'da webhook. Bot tokeni muhit o'zgaruvchisida. Foydalanuvchi boshiga oddiy rate-limit (daqiqasiga 20 so'rov).

## 11. Ma'lumotlar modeli

Siz bergan to'rt jadval saqlanadi; quyidagilar qo'shiladi.

**Asosiy:**
- `players(id, faceit_id UNIQUE, nickname, elo, level, created_at, updated_at)`
- `matches(id, faceit_match_id UNIQUE, map_name, started_at, finished_at)`
- `player_match_stats(id, player_id, match_id, kills, deaths, assists, headshots, adr, kast, rating, UNIQUE(player_id, match_id))`
- `highlights(id, match_id, player_id, type, round_number, tick_start, tick_end, created_at)`

**Qo'shiladi (2-quyi loyihadan):**
- `demos(id, match_id, status, storage_key, error, created_at, updated_at)`
- `rounds(id, match_id, round_number, winner_side, win_reason, start_tick, end_tick, UNIQUE(match_id, round_number))`
- `kills(id, match_id, round_number, tick, killer_id, victim_id, weapon, headshot, wallbang, noscope, thrusmoke, killer_x, killer_y, victim_x, victim_y)`
- `damages(id, match_id, round_number, tick, attacker_id, victim_id, weapon, damage_health, damage_armor)`
- `heat_bins(match_id, player_id, kind, side, bin_x, bin_y, count)`

**Indekslar:** `kills(match_id, round_number)`, `kills(killer_id)`, `kills(victim_id)`, `highlights(player_id, type)`, `player_match_stats(player_id)`.

**Migratsiya:** Flyway, `V1__init.sql` (asosiy 4 jadval), keyingi quyi loyihalar o'z migratsiyalarini qo'shadi. Entity'lar faqat sxemaga mos keladi, `ddl-auto=validate`.

## 12. Xavfsizlik va konfiguratsiya

- Barcha sirlar (`FACEIT_API_KEY`, DB paroli, MinIO kalitlari, bot tokeni) muhit o'zgaruvchilaridan; repoda faqat `.env.example`.
- Spring Security: MVP'da o'qish endpointlari ochiq, import/admin endpointlari statik API kaliti (`X-API-Key`) bilan himoyalanadi. Foydalanuvchi hisoblari 5-bosqichdan keyin.
- CORS faqat frontend origin'iga ruxsat beradi. Kiruvchi `nickname` uzunligi va belgilar bo'yicha tekshiriladi.

## 13. Kuzatuvchanlik

Spring Actuator + Micrometer → Prometheus, loglar → Loki, trace → OpenTelemetry. Asosiy metrikalar: FACEIT so'rov kechikishi va xato soni, demo pipeline bosqichlari bo'yicha davomiylik, navbat uzunligi, DLQ xabarlari.

## 14. Testlash

- **Backend:** birlik testlar (statistika formulalari, detektor mantig'i sintetik hodisalar bilan), integratsion testlar Testcontainers (PostgreSQL, Redis, RabbitMQ, MinIO), FACEIT klient WireMock bilan.
- **Parser:** kichik namunaviy `.dem` fayl bilan golden-test (kutilgan kill/round sonlari), Rust birlik testlari.
- **Frontend:** komponent testlari (Vitest), asosiy oqim uchun bitta E2E.
- **Detektorlar:** har tur uchun kamida bitta ijobiy va bitta chegaraviy (masalan, 5 kill emas 4 kill) test.

## 15. Server talablari

| Muhit | CPU | RAM | Disk |
|-------|-----|-----|------|
| Development | 4 | 8 GB | 100 GB SSD |
| MVP | 8 | 16 GB | 500 GB SSD |
| Production | 16 | 32 GB | 1 TB NVMe |

Demo fayllar disk hajmining asosiy iste'molchisi. Siqish (zstd) va eski demo'larni tozalash siyosati (masalan, 30 kundan keyin) 2-quyi loyihada belgilanadi.

## 16. Qabul qilingan qarorlar (ochiq savollar o'rniga)

1. **Foydalanuvchi turi:** shaxsiy/kichik jamoa, tijoratga ochiq arxitektura (c variant).
2. **Demo manbai:** avval FACEIT URL, zaxira sifatida qo'lda `.dem` yuklash.
3. **Parser–backend aloqasi:** faqat RabbitMQ + umumiy saqlash.
4. **Bot:** backend ichidagi modul, alohida servis emas.
5. **Highlight chegaralari:** konfiguratsiyada, kodda emas.

## 17. Kengaytma nuqtalari (5–6-bosqich)

- `highlights` jadvali render uchun tayyor: `tick_start`/`tick_end` renderer kirishi.
- Render navbati uchun alohida RabbitMQ exchange (`render.*`) va `render_jobs` jadvali keyin qo'shiladi; mavjud pipeline o'zgarmaydi.
- AI ranking `highlights.score` ustuni sifatida qo'shiladi.
