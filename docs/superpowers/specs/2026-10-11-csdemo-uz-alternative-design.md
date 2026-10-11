# csdemo.uz tahlili va muqobil mahsulot — Dizayn Spec

**Sana:** 2026-10-11
**Holat:** Qoralama, foydalanuvchi ko'rib chiqishini kutmoqda
**Oldingi spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` — uning 2, 3 va 17-bo'limlaridagi scope va tartib shu hujjat bilan almashtiriladi; qolgan bo'limlari (FACEIT integratsiyasi, demo pipeline, highlight qoidalari, statistika formulalari, ma'lumotlar modeli) kuchda qoladi.

## 1. Nima uchun bu hujjat

Oldingi spec video renderingni "MVP tashqarisida, keyin" deb belgilagan edi. Maqsad esa **csdemo.uz ga muqobil mahsulot** qurish, va u mahsulotning yuragi — demo'dan avtomatik topilgan highlight'ni bir bosishda **MP4 videoga** aylantirish. Videosiz loyiha statistika saytidan nariga o'tmaydi. Shu sababli video 3-rejadan keyingi birinchi ish bo'ladi, qolgan hamma narsa uning atrofida qayta tartiblanadi.

Bu hujjat uch narsani beradi: csdemo.uz nima qilishini (2–7-bo'limlar), bizda nima bor va nima yo'qligini (8-bo'lim), hamda yangi dekompozitsiya va video qismining dizaynini (9–12-bo'limlar).

**Manba haqida:** tahlil 2026-10-11 kuni saytning ochiq qismlaridan qilingan: bosh sahifa, brauzerga beriladigan frontend kodi va tarjima fayllari (2 130 ta matn), hamda sayt o'zi e'lon qilgan mobil API shartnomasi (`/mobile-api.openapi.json`, 142 operatsiya). Hisobga kirilmagan, yopiq sahifalar ko'rilmagan. Biz g'oya va funksiyalar to'plamini olamiz; kod, matn, dizayn va brend o'zimizniki bo'ladi.

## 2. csdemo.uz bir qarashda

CS2 o'yinchilari uchun "demo tahlili + highlight kliplar" platformasi, o'zbek auditoriyasiga qaratilgan (o'zbek, rus, ingliz, ukrain, qozoq tillari). Shiori: "Demo'laringni qayta ko'rma — o'qi".

Saytning ochiq ko'rsatkichlari (2026-10-11): **147 379** match parse qilingan, **55 248** klip yozilgan, oxirgi 7 kunda **5 037** faol o'yinchi. Ya'ni har 100 matchga taxminan 37 ta klip to'g'ri keladi — video asosiy qiymat ekanini shu ko'rsatadi.

Kanallari: veb-sayt (PWA), Telegram bot va Mini App, App Store va Google Play'dagi mobil ilovalar.

## 3. Asosiy foydalanuvchi sikli

```
Steam bilan kirish (FACEIT yoki email ham bor)
  -> match manbasini ulash: FACEIT (Steam ID bo'yicha avtomatik) yoki Steam matchmaking (share code)
  -> matchlar o'zi keladi; demo yuklab olinadi yoki qo'lda upload qilinadi; ~30 soniyada parse
  -> match sahifasi: scoreboard, roundlar, kill'lar, clutch'lar, duellar, heatmap, 2D replay
  -> highlight'lar avtomatik topilgan -> "Record clip" -> coin yechiladi -> navbat
  -> yozuvchi kompyuter CS2 da demoni o'ynatib yozadi -> MP4
  -> klip saytda va Telegram'da (MP4 fayl bilan) -> ulashish, Reels'ga chiqarish
```

Kirishdan klipgacha foydalanuvchi hech narsa yuklamaydi va sozlamaydi — eng kuchli tomoni shu.

## 4. Funksiyalar xaritasi

| Soha | csdemo.uz da nima bor |
|------|------------------------|
| Kirish | Steam OpenID, FACEIT OAuth, email + parol (OTP bilan tasdiqlash) |
| Match manbalari | FACEIT (tarix sinxroni), Steam Premier/Competitive (authentication code + share code zanjiri, har 30 daqiqada), qo'lda upload (`.dem`, `.gz`, `.zst`, `.bz2`, `.zip`, `.rar`), FASTCUP va community server demolari |
| Matchlar ro'yxati | Filtr (manba, xarita), saralash, "yuklanmoqda / demo kutilmoqda" bo'limi, bosqichlar: resolving → queued → downloading → parsing → saving |
| Match tahlili | Scoreboard 5 varaqda (Overview, Aim, Utility, Clutches & openings, Tactical), Rounds, Kills, Clutches, Duels matritsasi, Open kills, Heatmap, 2D replay |
| Ko'rsatkichlar | 37 ta: HLTV 2.1 rating, KAST, ADR, HS%, opening duel, clutch, trade, multi-kill 2K–5K, first-bullet/spray/counter-strafe aniqligi, crosshair placement, preaim, time to damage/kill, utility zarari, flash soniyalari va boshqalar |
| Highlight turlari | Ace, 4K, 3K, clutch 1vN, ninja defuse, pichoq, Zeus, bir o'q bilan bir necha kill (collateral), pistol ace |
| **Video** | Bitta highlight, to'liq match kompilyatsiyasi, montaj (qo'lda tanlangan kill'lar), to'liq round — 5-bo'limga qarang |
| Kliplar kutubxonasi | Tur, xarita, holat, ko'rinish bo'yicha filtr; sevimlilar; o'chirish; muammo haqida xabar berish |
| Ijtimoiy | Reels (ommaviy kliplar lentasi: yangi / hafta topi), like, izoh va javoblar, obuna, ommaviy profil va o'yinchi kartasi, profilga qadash, "Hafta klipi" tanlovi (100 coin) |
| Statistika | Profil KPI'lari, forma taqqosi (oxirgi N match va undan oldingi N), xaritalar bo'yicha, shaxsiy rekordlar, do'stlar bilan taqqoslash, yig'ma heatmap |
| Telegram | Hisobni bog'lash, klip tayyor bo'lganda xabar + MP4, match statistikasi jadvali, avtomatik match tahlili (pullik), klip muddati tugashi eslatmasi, kanalga obuna uchun coin |
| Coin va to'lov | Ro'yxatdan o'tganda 20 coin, kunlik bepul coin, referal, promokod; to'ldirish: Multicard (UZS), SBP (RUB), Polar (USD) |
| Qo'shimcha | 3D replay (pullik, match uchun bir marta), skin loadout'lar, "fun mode" (personaj modellari), turnirlar (esport), qo'llanmalar, callout'lar, FAQ, hamkorlik dasturi |
| Admin | Foydalanuvchilar (o'rniga kirish bilan), video job'lar, yozuvchi host'lar, musiqa, osmon (skybox), analitika, klip shikoyatlari, Telegram xabarnomalari, tizim sozlamalari |

## 5. Video qismi qanday ishlaydi

### 5.1. Klip turlari va narxi

| Tur | Nima | Narxi (coin) |
|-----|------|--------------|
| Bitta highlight | Bir voqea (ace, clutch, …) o'yinchi ko'zidan | 2–3 |
| Kompilyatsiya | Matchdagi hamma kill'lar va ninja defuse'lar | 8 (kill'lar soniga qarab o'zgaradi); o'limlarni qo'shish +2 |
| Montaj | Qo'lda tanlangan kill'lar, musiqa, sarlavha, intro | `1 + ceil(kill'lar / 4)`; intro +1 |
| To'liq round | Spawn'dan o'limgacha yoki round oxirigacha | alohida narx |

Qo'shimcha to'lovlar: 1080p va 2K sifat, 120 FPS, raqib ko'zidan takror (enemy POV), slow-motion, watermark'ni olib tashlash (+1), skin almashtirish, "fun mode" (+5), Telegram'ga video yuborish (+1). Narxlar serverda sozlanadi va reviziya raqami bilan yuradi: klient ko'rgan narx o'zgargan bo'lsa, so'rov rad etiladi va foydalanuvchi qayta tasdiqlaydi.

### 5.2. Yozish variantlari

Sifat 720p / 1080p / 2K; 60 yoki 120 FPS; 16:9, 4:3 cho'zilgan yoki 9:16 vertikal (Instagram uchun, fon shablonlari bilan); HUD yoqilgan / faqat killfeed / "o'yinchi" uslubi; X-ray; enemy POV (har kill'dan keyin yoki oxirida); kill'larda slow-motion; ovozli chat (faqat FACEIT matchlarida, 5 rejim); HDR rang korreksiyasi; watermark va o'yinchi kartasi; montajda musiqa (kutubxona yoki o'z fayli, 30 MB gacha), osmon va smoke rangi.

### 5.3. Texnik zanjir

```
"Record clip"
  -> backend: narxni hisoblaydi, coin'ni band qiladi, video job yaratadi (segmentlar: kill ticklari atrofida)
  -> navbat (ma'lumotlar bazasida)
  -> yozuvchi host: job'ni HTTP API orqali o'ziga oladi (worker tokeni bilan)
       demo faylni oladi -> CS2 ni HLAE bilan ishga tushiradi -> kerakli ticklarni o'ynatib yozadi
       -> ffmpeg: HLAE xom chiqishini yig'adi -> ffmpeg (NVENC): brending qatlami (logo, o'yinchi kartasi, yakuniy kadr)
  -> yuklovchi: MP4 va thumbnail -> Cloudflare R2; Mux orqali striming
  -> job holati SSE orqali brauzerga; Telegram bot xabar va MP4 yuboradi
  -> muvaffaqiyatsiz bo'lsa coin qaytariladi
```

Tasdiqlangan tafsilotlar:

- **Yozuvchi — oddiy Windows kompyuter.** CS2 serverda (Linux, GPU'siz) ishlamaydi, shuning uchun alohida "recording PC" bor. Sayt ochiq aytadi: "the recording PC is offline — new clips will queue". Tahlil paytida holat endpointi `video_worker_csdm@i512400f` nomli recorder'ni "ishlamoqda" deb ko'rsatdi; yuklovchi alohida jarayon.
- **Vositalar: HLAE + CS Demo Manager zanjiri.** API hujjati uch avlodni sanaydi: Python `video_worker`, Node `video_worker_js` (o'yin konsolini telnet orqali boshqaradi), Node `video_worker_csdm` (CS Demo Manager zanjirining ko'chirmasi). Hozirgisi — oxirgisi.
- **Host sozlamalari:** qaysi job turlari, sifat, FPS, tomonlar nisbati va **CS2 patch versiyalari** ruxsat etilgani; navbat ustuvorligi qoidalari; ffmpeg parametrlari. Patch versiyasi muhim: demo faqat mos keladigan o'yin versiyasida o'ynaladi.
- **Job holatlari:** queued → claimed → recording (foiz bilan) → encoding → uploading → Mux'da qayta ishlash → done / failed; urinishlar soni; host yurak urishi (heartbeat).
- **Segmentlar:** montajda har kill'dan 3 s oldin va 2 s keyin, ustma-ust tushganlari birlashtiriladi; kompilyatsiyada 5 s / 3 s.
- **Cheklovlar:** 30 kundan eski matchdan klip yozilmaydi (`clip_max_demo_age_days = 30`); CS2 ning 2026-yil 21-apreldagi yangilanishidan oldingi demolar umuman qabul qilinmaydi; faqat 5×5 matchlar; tayyor kliplarning ham saqlash muddati bor (tugashidan oldin eslatma keladi).

## 6. Demo qayerdan olinadi

Bu — ikkinchi qiyin muammo, va csdemo.uz ham uni to'liq yecha olmagan.

- **FACEIT.** Tarix Data API orqali keladi va match darhol ro'yxatda "demo kutilmoqda" holatida ko'rinadi. Demo faylning o'zi FACEIT'ning alohida **Downloads API**'si orqali olinadi: `demo_url` — bu shunchaki resurs manzili, yuklab olish uchun imzolangan havola kerak. Ruxsat ariza bilan beriladi (javob 30 kungacha) va kvotasi bor. Tahlil kuni csdemo.uz da bu yo'l **cheklangan** edi (`/api/faceit/downloads-status` → `limited: true`), sayt foydalanuvchidan demoni qo'lda upload qilishni so'rayapti. Aylanma yo'llari: FACEIT match sahifasiga "Send to csdemo.uz" tugmasini qo'shadigan brauzer kengaytmasi (brauzerdagi imzolangan havolani serverga yuboradi) va coin evaziga "avtomatik yuklash".
- **Steam matchmaking.** Foydalanuvchi bir marta authentication code va bitta share code beradi; server Valve API orqali keyingi share code'larni zanjir bo'ylab topadi, o'yin koordinatoriga ulangan Steam bot demo havolasini oladi.
- **Qo'lda upload** — har doim ishlaydigan zaxira.

Biz 2026-10-11 da o'z kalitimiz bilan tekshirdik: `demo_url` hosti ochiq internetda ochilmaydi, Downloads API esa `403 no valid scope provided` qaytaradi. Demak boshida bizda ham qo'lda upload asosiy yo'l bo'ladi.

## 7. Monetizatsiya va texnologiya

**Coin iqtisodi.** Ko'rish va statistika bepul; coin faqat video, 3D replay, demoni avtomatik yuklash va avtomatik tahlilga ketadi. Bepul oqim kuchli: 20 coin boshida, har kuni bepul coin (balans chegaradan past bo'lsa), Telegram kanaliga obuna uchun qo'shimcha, referal. Pullik to'ldirish — karta orqali, bonus foizlari bilan. Coin bir vaqtda ikki ish qiladi: daromad va yagona yozuvchi kompyuterning navbatini cheklash.

**Texnologiya.** Frontend — React + Vite, Cloudflare Pages; backend — Python FastAPI; navbat va SSE uchun Redis; fayllar — Cloudflare R2; video striming — Mux; push — Firebase; esport ma'lumoti — PandaScore; mobil ilovalar uchun alohida e'lon qilingan API shartnomasi.

## 8. Bizdagi holat bilan solishtirish

| Soha | Bizda (2026-10-11) | Farq |
|------|--------------------|------|
| FACEIT profil, tarix, match statistikasi | Bor (1-reja), haqiqiy kalit bilan tekshirilgan | Hisobsiz, nickname bo'yicha qidiruv |
| Demo upload → parse → faktlar | Bor (2-reja) | FACEIT'dan avtomatik yuklash ishlamaydi (Downloads ruxsati yo'q) |
| Highlight va statistika | Bajarilmoqda (3-reja, 6 vazifadan 1-si yozilgan) | csdemo'dagi 37 ko'rsatkichdan 8 tasi rejada |
| **Video** | **Yo'q** | Mahsulotning yuragi |
| Hisoblar, "mening matchlarim" | Yo'q (faqat admin kaliti) | Kerak |
| Telegram | Yo'q (4-rejada faqat buyruqlar edi) | Klip yetkazish kerak |
| Coin, to'lov | Yo'q | Kerak (ochiq foydalanishdan oldin) |
| Heatmap, 2D replay, chuqur ko'rsatkichlar | Yo'q (heatmap 4-rejada edi) | Keyinroq |
| Ijtimoiy qism, admin konsoli, mobil ilova | Yo'q | Keyinroq |

Bizning poydevor mos keladi: parser faktlarni, backend talqinni beradi; `highlights.tick_start/tick_end` va `kills.tick` — renderer uchun tayyor kirish.

## 9. Yangi dekompozitsiya

Har quyi loyiha o'z rejasi bilan bajariladi va o'zi ishlaydigan natija beradi. 1–3 o'zgarmaydi; eski 4-reja ikkiga bo'linib, yangi rejalarga singadi.

| # | Quyi loyiha | Natija | Bog'liqlik |
|---|-------------|--------|------------|
| 3 | Highlight va statistika (davom etmoqda) | Highlight'lar ro'yxati, asosiy statistika, UI | 2 |
| **5** | **Video rendering** | Highlight → MP4: navbat, yozuvchi worker, saqlash, pleyer; kompilyatsiya | 3 |
| 6 | Hisoblar va "mening matchlarim" | Steam bilan kirish, FACEIT'ni bog'lash, matchlar sinxroni, upload UX, klip egaligi | 5 |
| 7 | Telegram: yetkazish va bot | Hisobni bog'lash, klip tayyor → xabar + MP4, buyruqlar | 5, 6 |
| 8 | Coin va to'lovlar | Hisob-kitob daftari, narxlar, band qilish/qaytarish, kunlik coin, karta orqali to'ldirish | 6 |
| 9 | Match tahlilini chuqurlashtirish | Kengaytirilgan ko'rsatkichlar, match varaqlari, heatmap, 2D replay, rekordlar | 3 |
| 10 | Klip variantlari va brending | Har biri mijoz tanlaydigan pullik variant: sifat va FPS (60–600; csdemo.uz da 60 va 120), motion blur va slow-mo, ovoz, raqib ko'zidan ko'rsatish (ketma-ket yoki yonma-yon), skin; yana watermark va o'yinchi kartasi, X-ray, vertikal 9:16, montaj, to'liq round | 5 |
| 11 | Ijtimoiy qism | Ommaviy klip sahifasi, Reels, like/izoh, profil, tanlov | 6, 10 |
| 12 | Admin konsoli va ekspluatatsiya | Job va host boshqaruvi, analitika, prod deploy, monitoring | 5–8 |
| 13+ | Keyin | Steam matchmaking sinxroni, 3D replay, skin/fun mode, turnirlar, mobil ilova, ko'p tillilik, AI ranking | — |

**Tartib asosi.** Video birinchi, chunki eng katta texnik xavf shu yerda (Windows kompyuter, CS2, HLAE) va foydalanuvchi qiymati ham shu yerda. U hisoblarsiz ham ishlaydi: klipni admin kaliti bilan so'rash mumkin. Hisoblar ikkinchi, chunki ularsiz boshqa odam foydalana olmaydi. Coin ochiq foydalanishdan oldin kerak, aks holda yagona yozuvchi kompyuter navbati boshqarilmaydi. 9 va 10 mustaqil — 6–8 bilan parallel yurishi mumkin.

Vazifalar: 5-reja — `docs/superpowers/plans/2026-10-11-05-video-rendering.md`; 6–12 — yo'l xaritasida vazifalar darajasida (`docs/superpowers/plans/2026-10-08-00-roadmap.md`), har biri boshlanishidan oldin bajariladigan rejaga aylantiriladi.

## 10. Video quyi loyihasining dizayni

```
Frontend ──► Backend (clip API) ──► PostgreSQL: clips
                 ▲     │
   worker API    │     └──► MinIO: clips/<id>.mp4, clips/<id>.jpg
 (HTTPS, token)  │
                 │
        Recorder worker (Windows: CS2 + HLAE + CS Demo Manager + ffmpeg)
        yoki soxta recorder (Docker: ffmpeg sinov tasviri) — ishlab chiqish uchun
```

**Qarorlar:**

1. **Klip = job.** Bitta `clips` jadvali ham navbat, ham natija. Oldingi spec 17-bo'limdagi `render_jobs` + `render.*` exchange g'oyasi o'rniga.
2. **Recorder ishni o'zi so'rab oladi (HTTPS pull), RabbitMQ orqali emas.** Yozuvchi kompyuter uy yoki ofis tarmog'ida, NAT ortida turadi; brokerni internetga ochish xavfli, kompyuterga tashqaridan ulanib bo'lmaydi. Navbat — PostgreSQL'da `FOR UPDATE SKIP LOCKED`. csdemo.uz ham shu yo'ldan borgan.
3. **Demo va video backend orqali o'tadi.** Recorder demoni backend'dan oladi, MP4 ni backend'ga yuklaydi; MinIO internetga ochilmaydi.
4. **Birinchi versiyada yozish — CS Demo Manager CLI (`csdm video`) orqali.** U HLAE, CS2 plagini, ffmpeg va segmentlarni birlashtirishni o'zi hal qiladi va o'yin yangilanishlaridan keyin jamoa tomonidan tuzatiladi. O'z HLAE drayverimiz — faqat tezlik yoki nazorat yetmay qolganda. csdemo.uz uch marta qayta yozib, oxiri shu zanjirga kelgan.
5. **Recorder — Node.js/TypeScript dasturi** (`recorder/`). Bir xil kod ikki rejimda ishlaydi: `csdm` (Windows) va `fake` (Docker, ffmpeg sinov tasviri). Soxta rejim butun zanjirni Windows'siz qurish va tekshirish imkonini beradi — 2-rejadagi soxta FACEIT kabi.
6. **Klip highlight'ga tabiiy kalit bilan bog'lanadi** (`match, player, type, round, tick_start`), `highlights.id` bilan emas: qayta tahlil highlight qatorlarini almashtiradi, kliplar esa qolishi kerak.
7. **Segmentlar kill ticklari atrofida** quriladi (3 s oldin, 2 s keyin, yaqinlari birlashtiriladi); o'yinchining kill'i bo'lmagan highlight'da (ninja defuse) — highlight oynasining o'zi.
8. **Demo fayli bor bo'lgandagina yoziladi.** Demo 30 kundan keyin o'chiriladi (2-reja), shundan keyin klip so'rovi rad etiladi.
9. **Hozircha klip so'rash admin kaliti bilan**, ko'rish ochiq. Egalik va kvota 6-rejada, narx 8-rejada qo'shiladi.

**Holat mashinasi:** `QUEUED → RECORDING → ENCODING → UPLOADING → DONE`; istalgan faol holatdan `FAILED`; qayta uriniladigan xato yoki yo'qolgan recorder → `QUEUED` (urinishlar chegarasigacha).

## 11. Xavflar

- **Yozuvchi kompyuter yo'q yoki kuchsiz.** Diskret GPU'li, CS2 ni ravon yurita oladigan Windows kompyuter kerak, va u doim yoqiq turishi lozim. Usiz 5-rejaning ikki vazifasi (sinov va haqiqiy yozish) bajarilmaydi; qolgani soxta recorder bilan quriladi.
- **CS2 yangilanishlari.** Har katta yangilanish HLAE'ni vaqtincha sindirishi va eski demolarni o'ynalmas qilishi mumkin. Kliplar matchdan keyin tez yozilishi kerak; recorder xatoni aniq sabab bilan qaytarishi kerak.
- **Steam hisobi.** HLAE o'yinga ulanadi, CS2 `-insecure` bilan ishga tushadi. Yozuvchi kompyuterda alohida Steam hisobi ishlatiladi.
- **Bitta recorder — tor joy.** Bir klip daqiqalar oladi; navbat uzunligi va kutish vaqti o'lchanadi, ikkinchi host qo'shish protokolda ko'zda tutilgan.
- **FACEIT demo yuklash.** Downloads API ruxsati yo'q; ariza hozir yuborilishi kerak (30 kungacha kutiladi). Ungacha qo'lda upload.
- **Fayl hajmi va trafik.** 1080p klip o'nlab megabayt; Telegram bot orqali 50 MB dan katta fayl yuborilmaydi (7-rejada hisobga olinadi).
- **Valve video siyosati.** Rasmiy matnga ko'ra Valve kontentidan videolarda foydalanish notijorat bo'lishi kerak: tomoshabindan videoni ko'rish yoki olish uchun pul olinmaydi, video sotilmaydi (<https://store.steampowered.com/video_policy>). Foydalanuvchi qarori (2026-10-11): xizmat pullik bo'ladi, xavf qabul qilingan; ofertada to'lov yozish xizmati uchun ekani yoziladi (8-reja T6).
- **Skin tanlash.** csdemo.uz buni pullik variant sifatida beradi ("Loadouts": agent, qurol, pichoq, qo'lqop; faqat o'yinchining o'z qurollariga). Foydalanuvchi qarori bilan bizda ham qilinadi — 10-rejaning oxirgi vazifasi, usul texnik sinovda tanlanadi: tayyor vosita topilmadi, o'yin klientini o'zgartiradigan o'z modulimiz kerak bo'ladi (faqat oflayn, alohida hisobda; yangilanishlarda sinadi).

## 12. Foydalanuvchi hal qiladigan savollar

1. Yozuvchi kompyuter: bormi, qanday (protsessor, videokarta), doim yoqiq tura oladimi?
2. Mahsulot nomi va domeni (watermark, bot nomi, bosh sahifa uchun).
3. To'lov provayderi (Payme / Click / Multicard) va yuridik shakl — 8-rejadan oldin.
4. FACEIT Downloads API ga ariza yuborish.
5. Repozitoriy hozir ochiq (public): raqobatchi tahlili va reja ochiq turishi maqbulmi?

## Manbalar

- https://csdemo.uz — bosh sahifa, frontend kodi va tarjimalari, `/mobile-api.openapi.json`, `/api/landing/stats`, `/api/video/worker-status`, `/api/faceit/downloads-status`, `/api/video/recording-status` (2026-10-11)
- https://cs-demo-manager.com/docs/cli — `csdm video` buyrug'i
- https://cs-demo-manager.com/docs/guides/video — video yaratish, platformalar bo'yicha qo'llab-quvvatlash
- https://cs-demo-manager.com/docs/guides/downloads — FACEIT yuklab olish cheklovi
- https://docs.faceit.com/getting-started/Guides/download-api — FACEIT Downloads API
