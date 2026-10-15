# Telefon ko'rinishi: pastki panel, ikki qatorli matchlar, ro'yxat kartochkalar — dizayn

**Sana:** 2026-10-15. **Holat:** foydalanuvchi ma'qullagan ("ha yoqdi").

**Maketlar:** canvas "CsFaceIt · Telefon" — https://claude.ai/artifact/3f14tCAcJ5UfQHkeksp3v8 (faqat foydalanuvchiga
ko'rinadi). Tanlangan artboard'lar: "A · Pastki panel" (`Main.dc.html`), "A · Ikki qatorli" (`RowsA.dc.html`),
"A · Ro'yxat" (`CardsA.dc.html`). B variantlari tanlanmagan.

**Asos:** UI shartnomasi — `docs/superpowers/specs/2026-10-11-web-ui-design.md` (tokenlar, komponentlar, jonli uslub).
Bu hujjat undagi telefon (`max-md`) qoidalariga qo'shimcha; ishga tushirishda avval o'sha hujjatga shu yerdagi qatorlar
yoziladi, keyin kod.

## 1. Maqsad va foydalanuvchi so'zi

Foydalanuvchi: "kel dizayn ustida ishlaylik" → yaxshilash kerak bo'lgan joylar: **ichki sahifalar** va **telefonda
ko'rinishi**. Uni bezovta qilgani: "Ro'yxatda ma'lumot kam", "Navigatsiya noqulay", "Kartochkalar katta".
"Sahifalar juda uzun" tanlanmagan — bo'limlar avvalgidek bitta sahifada ketma-ket qoladi.

Muvaffaqiyat mezoni: 390 px ekranda (1) bo'limlar orasida bir tegishda o'tiladi, (2) "Matchlar" ro'yxatida kompyuterdagi
asosiy ma'lumot (K/D/A, ADR, highlight'lar, klip holati, demo yuklash) ko'rinadi, (3) highlight va klip kartochkalari
ekranga 3–4 baravar ko'proq sig'adi; kompyuterdagi (≥ 768 px) ko'rinish o'zgarmaydi.

## 2. Doira

**Faqat `max-md` (< 768 px).** `md` va undan kengda hamma narsa hozirgidek; 1440 px rasmlari oldingisi bilan bir xil
bo'lishi tekshiriladi.

Tegishli sahifalar: `/players/:playerId` (profil), `/players/:playerId/matches` (Matchlar),
`/players/:playerId/highlights`, `/matches/:matchId`, `/clips`, `/clips/:clipId` (faqat yuqori va pastki panel),
`/matches/:matchId/montaj` (faqat yuqori panel; pastki panel yo'q). Bosh sahifa (`/`) hero qismi o'zgarmaydi.

Doiradan tashqari: yangi ma'lumot yoki endpoint, sahifalarni tablar bilan bo'lish, landing dizayni, kompyuter
ko'rinishi, yangi test (foydalanuvchi qarori: hozircha test yozilmaydi).

## 3. Navigatsiya — "A · Pastki panel"

### 3.1 Yuqori panel (`TopBar`, `max-md`)

- Bitta qator, balandligi 56 px: chapda `Logo`; o'ngda qidiruv tugmasi (44×44, lupa ikonkasi,
  `aria-label` "O'yinchi qidirish") va avatar tugmasi (hisob menyusi) yoki "Kirish" tugmasi.
- Hozirgi nav havolalari (Matchlar, Kliplar, Statistika) va `LanguageSwitch` telefonda yuqori paneldan olinadi.
- Qidiruv tugmasi bosilganda `TopBarSearch` yuqori panel ostida butun kenglikda ochiladi (fokus maydonga tushadi;
  Esc yoki yana bosish yopadi; tanlangan o'yinchiga o'tilganda yopiladi).
- Til tanlovi: hisob menyusida (kirganlar uchun) va `Footer`da (hamma uchun) — UZ/EN tugmalari.

### 3.2 Pastki panel (yangi `BottomNav`)

- Faqat `max-md`, `position: fixed` pastda, balandligi 64 px + `env(safe-area-inset-bottom)`; fon `--card`, yuqorida
  `1px --border`; `<nav aria-label>`; teng ustunlar (grid).
- Har band: ikonka (22 px, chiziqli SVG) va yozuv (11 px), butun ustun bosiladi (≥ 44 px). Faol band:
  `aria-current="page"`, yozuv `--foreground` 600, tepasida 28×2 px `--rec` chiziq; nofaol: `--subtle`.
- Bandlar (manzil `useMe()` dan; o'yinchi id'si — `playerId`, bo'lmasa `steam:<steamId>` — `ownMatchesPath` qoidasi):

  | Kim | Bandlar |
  |---|---|
  | Kirgan, o'yinchisi bor (FACEIT yoki `steam:`) | Matchlar → `/players/{id}/matches`; Highlight'lar → `/players/{id}/highlights`; Kliplar → `/clips`; Profil → `/players/{id}` |
  | Kirmagan mehmon | Bosh sahifa → `/`; Kliplar → `/clips`; Kirish (tugma, `SignInDialog` ochadi) |

  Faollik: joriy manzil bandning manziliga teng yoki undan boshlanadi (`/clips/:id` — "Kliplar"); bundan tashqari
  `/matches/:id` — "Matchlar" faol (match sahifasiga Matchlar ro'yxatidan o'tiladi). Boshqa o'yinchining sahifasida
  hech qaysi band faol emas.
- Ko'rinmaydigan joylar: `/matches/:matchId/montaj` (muharririning o'z yopishqoq "Buyurtma" paneli bor) va bosh sahifa
  `/` mehmon uchun (hero). Ochiq dialog (klip buyurtmasi, kirish) panel ustida turadi.
- Kontent yopilmasligi: `AppLayout`ning asosiy qismi va `Footer` `max-md`da pastdan
  `calc(64px + env(safe-area-inset-bottom))` joy qoldiradi; `scroll-padding-bottom` ham shunchaga oshadi.

## 4. Matchlar qatori — "A · Ikki qatorli"

Qayerda: `MatchesTable` (Matchlar sahifasi) va profildagi match tarixi qatorlari, `max-md`.

- Qator: chapda 3 px natija chizig'i va natija rangidagi xira fon (jonli uslubdagidek, o'zgarmaydi), ichki chekinish
  12/16 px.
- **1-qator:** `MapEmblem` 40 px; xarita nomi (15 px 600, match sahifasiga havola); ostida `SourceTag`
  (FACEIT yoki CS2 MM) va sana (mono 11 px `--subtle`); o'ngda hisob (mono 19 px 600, natija rangi) va natija so'zi
  (11 px).
- **2-qator** (emblema kengligicha chekinish bilan): K/D/A (mono 13 px 500), `ADR` qiymati (mono 11 px `--subtle`),
  3 tagacha `HighlightTag` (kichik o'lcham) va qolgan soni `+N`; o'ng chekkada quyidagidan biri:
  - klip holati matni ("1 klip tayyor" `--positive`, "Tahlil qilinmoqda", "Navbatda" — mavjud matnlar);
  - demo kerak bo'lsa, mavjud qator amali — "Demo" tugmasi (yuklash ikonkasi bilan, ≥ 36 px balandlik, qator bosilish
    maydoni bilan birga 44 px'ga yetadi).
  Ma'lumot yo'q joyda (masalan K/D/A yo'q) "– / – / –" o'rniga bu qism ko'rsatilmaydi, faqat holat qoladi.
- Filtr tablari (Hammasi / Tahlil qilingan / Demo kerak) `max-md`da bitta qatorda, gorizontal aylanadi
  (`overflow-x: auto`, pill ko'rinishi 36 px), sonlar mono.
- Ustun sarlavhalari (XARITA, HISOB) `max-md`da ko'rsatilmaydi.

## 5. Kartochkalar — "A · Ro'yxat"

### 5.1 Highlight qatori (`HighlightCard`, `max-md`)

Qayerda: match sahifasi, `/players/:id/highlights`, profil.

- Qator 64 px rasm balandligi + 10 px vertikal chekinish (~84–88 px), pastda `1px --border`.
- Chapda 112×64 px kichik rasm: xarita manzarasi (`SceneryBand` manbasi, `object-fit: cover`), chap yuqorida
  `HighlightTag` (9 px), o'ng pastda davomiylik (mono 10 px, xira qora fon).
- O'rtada: raund va tomon (mono 10 px, tomon `--side-ct`/`--side-t`), o'yinchi (15 px 600, bir qator, kesiladi),
  qurol/tafsilot (12 px `--muted-foreground`, bir qator).
- O'ngda 44×44 px amal, holatga qarab:
  - klip yozish mumkin — oq tugma ichida qizil nuqta (`aria-label` "Klip yozish"), mavjud buyurtma dialogini ochadi;
  - klip tayyor — `--positive` chegarali "ko'rish" tugmasi (▶), klip sahifasiga;
  - yozilmoqda/navbatda — holat matni (mono 11 px): foiz yoki "Navbat";
  - xato — "Qayta" (mavjud "Qayta urinish" amali).
- Hozirgi kartochkadagi kill chizig'i (`KillTimeline`) telefonda ko'rsatilmaydi.

### 5.2 Klip qatori (`ClipCard`, `max-md`)

Qayerda: match sahifasining "Kliplar" bo'limi, `/clips`, profil.

- Butun qator klip sahifasiga havola; chapda 112×64 px rasm (manzara), ustida holat: yozilmoqda — foiz va pastda
  3 px `--rec` progress; tayyor — ▶.
- O'ng tomonda: sarlavha (`1v3 CLUTCH · s1mple`, 14 px 600, bir qator), raund va sifat (`R9 · 1080p120`, mono 10 px),
  holat (mono 10 px, holat rangi: YOZILMOQDA `--rec`, TAYYOR `--positive` + hajmi, XATO `--negative`).

### 5.3 Match sahifasi sarlavhasi va tablar (`max-md`)

- Sarlavha ixcham: emblema 44 px, xarita (20 px 700), `SourceTag` + sana; o'ngda hisob (mono 26 px, natija rangi) va
  natija so'zi; fonda natija rangidagi yuqoridan pastga xira gradient. `RoundStrip` sarlavha ostida qoladi
  (gorizontal aylanadi).
- Bo'lim tablari (`SectionTabs`, hozirgidek havolalar) teng uch ustun, 48 px, yuqori panel ostida yopishqoq
  (`position: sticky; top: 56px`), fon `--background`.

## 6. Kirish imkoniyati

- Barcha bosiladigan joylar ≥ 44 px (Demo tugmasi qator bilan birga); ikonkali tugmalarda `aria-label`.
- Pastki panelda `aria-current="page"`; Tab tartibi: yuqori panel → kontent → footer → pastki panel.
- Ranglar faqat rang bilan emas: natija chizig'i yonida "G'alaba"/"Mag'lubiyat" so'zi, holatlar matn bilan.
- `prefers-reduced-motion`: qidiruv paneli ochilishida animatsiya yo'q.

## 7. Tekshiruv

- Avval `2026-10-11-web-ui-design.md`ga yangi/o'zgargan qatorlar (o'zbekcha): `BottomNav`, telefon `TopBar`,
  matchlar qatori, highlight va klip qatori, match sarlavhasi, yopishqoq tablar; keyin kod.
- `npm run lint`, `npm run build`, Vitest (120), e2e (`search-flow`), `npm run shots`: barcha ichki sahifalar
  390 va 1440 px, uz va en; 390 rasmlari ko'zdan kechiriladi; 1440 rasmlari ish boshidagisi bilan solishtiriladi
  (farq bo'lmasligi kerak). Yangi holatlar shots'ga: mehmon pastki paneli, kirgan foydalanuvchi pastki paneli,
  ochiq qidiruv.
- Yangi test yozilmaydi; mavjudlari buzilmaydi.

## 8. Ochiq savollar

Yo'q — uch tanlov ham foydalanuvchi tomonidan qilingan (A, A, A).
