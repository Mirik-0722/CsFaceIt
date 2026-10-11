# Veb interfeys dizayni: "A · REC" yo'nalishi

**Sana:** 2026-10-11
**Holat:** yo'nalish foydalanuvchi tomonidan tanlangan (uch variantdan A); ekranlar bo'yicha o'zgartirish so'ralmagan.
**Maket:** <https://claude.ai/artifact/UuKDJd2gJ3hLVKbRL85qLk> (shaxsiy havola; 8 ekran va 3 uslub varianti). Maket — ko'rinish manbai, bu hujjat — uning matnli shartnomasi: maketni ocholmagan implementer uchun shu hujjat yetarli bo'lishi kerak. Farq chiqsa, shu hujjat ustun; maketni o'zgartirgan qaror shu yerga ham yoziladi.
**Bog'liq hujjatlar:** mahsulot va rejalar — `2026-10-11-csdemo-uz-alternative-design.md`; yo'l xaritasi — `../plans/2026-10-08-00-roadmap.md`; birinchi bajariladigan qism — `../plans/2026-10-11-0D-ui-foundation.md`.

## 1. G'oya

- Mahsulot klip **yozadi**, interfeys shuni aytadi: kamera ramkasi (kadr burchaklaridagi qavslar), qizil REC nuqtasi, taymkod.
- Sayt qobig'i monoxrom: to'q kulrang fon, och matn, oq tugma. Rang faqat ma'lumot uchun ishlatiladi: qizil — yozilayotgan narsa va kill lahzalari; ko'k va sariq — CT va T; yashil va qizg'ish — natija.
- Raqamlar va xizmat yozuvlari mono shriftda, matn Geist'da.
- Burchaklar o'tkir: panel 0, tugma va input 4 px, teg 2 px. Soya yo'q; gradient faqat video kadridagi yengil tus sifatida.
- csdemo.uz ham, FACEIT ham to'q fon va to'q sariq rangda. Bizda to'q sariq ishlatilmaydi.
- Faqat to'q mavzu; yorug' mavzu yo'q.

## 2. Tokenlar

### 2.1 Ranglar

| CSS o'zgaruvchisi | Qiymat | Vazifasi |
|-------------------|--------|----------|
| `--background` | `#0B0C0E` | sahifa foni |
| `--card` | `#111316` | panel, karta, jadval, input foni |
| `--secondary`, `--muted`, `--accent`, `--popover` | `#17191D` | ko'tarilgan sirt: hover, o'z qatori, skeleton |
| `--border` | `#22262B` | ingichka ajratuvchi chiziqlar, panel chegarasi |
| `--line-strong` (yangi), `--input` | `#2F343B` | ikkilamchi tugma chegarasi, progress yo'li |
| `--foreground`, `--card-foreground` | `#ECEEF0` | asosiy matn |
| `--muted-foreground` | `#A9B0B8` | ikkilamchi matn |
| `--subtle` (yangi) | `#8B939D` | uchinchi darajali matn, mono yorliqlar (`--secondary` ustida 5.6:1) |
| `--primary` | `#F1F2F3` | asosiy tugma foni |
| `--primary-foreground` | `#0B0C0E` | asosiy tugma matni |
| `--ring` | `#6B737D` | fokus halqasi, kontur teg chegarasi |
| `--rec` (yangi) | `#FF4133` | REC nuqtasi, kill belgilari, yozish progress chizig'i |
| `--positive` (yangi) | `#57D58C` | g'alaba, tayyor, onlayn |
| `--negative` (yangi), `--destructive` | `#FF7468` | mag'lubiyat, xato |
| `--side-ct` (yangi) | `#7CAEFF` | CT tomoni |
| `--side-t` (yangi) | `#F1B550` | T tomoni |

Qoidalar:

- `--rec` oq matn ostida fon bo'la olmaydi (kontrast 3.5:1). U nuqta, 2 px chiziq, chegara yoki matn rangi sifatida ishlatiladi; ustiga matn kerak bo'lsa, matn `--primary-foreground`.
- Natija, tomon va holat hech qachon faqat rang bilan berilmaydi: yonida so'z yoki harf bo'ladi.
- Video kadri foni: `#0E1013` ustida xarita tusi — `radial-gradient(90% 80% at 35% 45%, <sahna> 0%, #15130F 50%, #0E1013 82%)`.

Xarita tuslari (FACEIT nomidagi ikki harfli o'yin rejimi old qo'shimchasi — `de_`, `cs_`, `ar_` — olib tashlanadi, kichik harfda solishtiriladi; `cs_office` — "Office"):

| Xarita | Katakcha | Sahna |
|--------|----------|-------|
| mirage | `#4A3B22` | `#3A2F1C` |
| inferno | `#4A2A1E` | `#3B2219` |
| ancient | `#22402F` | `#1D3326` |
| nuke | `#223647` | `#1C2B3A` |
| anubis | `#4A3F1F` | `#3A311A` |
| dust2 | `#4D4428` | `#3B3421` |
| boshqa hammasi | `#2A2F35` | `#1E2226` |

### 2.2 Shrift

Sans — `Geist Variable` (`@fontsource-variable/geist`, loyihada bor); mono — `Geist Mono Variable` (`@fontsource-variable/geist-mono`). Shriftlar loyiha bilan birga tarqatiladi, tashqi so'rov yo'q.

| Rol | O'lcham / qator balandligi / vazn / harf oralig'i |
|-----|---------------------------------------------------|
| Hero sarlavha | `clamp(40px, 5vw, 72px)` / 1.02 / 600 / −0.035em |
| Sahifa sarlavhasi (h1) | 30px / 1.2 / 600 / −0.02em |
| Bo'lim sarlavhasi (h2) | 22px / 1.3 / 600 / −0.01em |
| Karta sarlavhasi | 17px / 1.4 / 600 |
| Asosiy matn | 15px / 1.5 / 400 |
| Ikkilamchi matn | 13–14px / 1.5 |
| Mono yorliq | mono 11px, 0.08em, bosh harflar, `--subtle` |
| Mono raqam (jadval) | mono 13px |
| Katta hisob | mono `clamp(44px, 5vw, 64px)` / 1 / 600 |

Bir necha komponent ishlatadigan rollar `frontend/src/index.css` da `@utility` sinflari: `label-mono` (mono yorliq), `heading-page` (sahifa sarlavhasi), `heading-section` (bo'lim sarlavhasi), `number-mono` (mono raqam), `score-big` (katta hisob). Komponentda bu rollar qo'lda qayta yozilmaydi.

### 2.3 O'lcham va joylashuv

- Konteyner: eng ko'pi 1280px, yon bo'shliq `clamp(16px, 4vw, 40px)`; sahifa tepasida 36px, pastida 72px; bo'limlar orasi 24–36px.
- Bosiladigan har element kamida 44px: tugma 44px (`lg` 52px), ikonka tugmasi 44×44, jadval qatori 44px, ro'yxat qatori 56–72px.
- Radius: panel 0; tugma va input 4px; teg 2px; avatar doira.
- Fokus: 2px `--ring` kontur, 2px masofada. Istisno: suriladigan quti ichidagi havola (scoreboard'dagi nickname) konturni o'z ichida chizadi (`-outline-offset-2`), chunki quti chekkasi tashqi konturni kesib qo'yadi; kontur harflarga tegmasligi uchun havolaning o'zida 8px yon bo'shliq bor (manfiy tashqi bo'shliq uni joyida ushlaydi) va u kamida 44px kenglikda.
- 390px kenglikda sahifa yon tomonga surilmaydi: keng jadval o'z qutisi ichida suriladi, tepa panel va tugma qatorlari yangi qatorga tushadi.

## 3. Komponentlar

"Qachon" ustuni komponent qaysi rejada quriladigani: **D** — `2026-10-11-0D-ui-foundation.md`.

| Komponent | Tuzilishi | Qachon |
|-----------|-----------|--------|
| `Logo` | 26px belgi: to'rt burchak qavsi (2px chiziq, matn rangida) va markazda `--rec` doira; yonida mono 15px/600 `csfaceit` (ishchi nom) | D |
| `Button` | `default`: fon `--primary`; `outline`: shaffof, chegarasi `--line-strong`; `ghost`; `link`: tagiga chizilgan. O'lchamlar: 44px (yon 18px, 14px/600), `lg` 52px (yon 24px, 15px/600), `icon` 44×44. "Yozish" amalida matndan oldin 8px `--rec` nuqta | D (nuqtasiz); "Yozish" amali va nuqta — 5-reja T6 |
| `Badge` (teg) | 22px, mono 11px/600, 0.06em, bosh harflar. `default` (to'ldirilgan och) — faqat eng yuqori daraja uchun (ACE); `outline` (chegarasi `--ring`); `secondary` (chegarasi `--border`, matn `--muted-foreground`); `positive` va `negative` (kontur va rangli matn) | D |
| `Input` | 44px (hero'da 52px), fon `--card`, chegarasi `--border`, placeholder `--subtle` | D |
| Jadval (scoreboard) | panel (`--card`, chegarasi `--border`); sarlavha qatori 36px, mono yorliq; qatorlar 44px, ustida chiziq; ism 14px/500, raqamlar mono 13px, o'ngga tekislangan; K qalin; D va A `--muted-foreground`; K/D 1 dan past bo'lsa `--muted-foreground`; sarlavhada mag'lub jamoaning hisobi `--subtle`, nomi `--muted-foreground` (`MatchScore` bilan bir xil); telefonda (`sm` dan past) raqam ustunlari 8px yon bo'shliq bilan ixcham: oltita raqam ustuni ham 360px da sig'adi, `sm` dan boshlab ustun kamida 68px va yon bo'shliq 16px; juda tor ekranda yoki juda uzun nickname'da jadval o'z qutisida suriladi, o'yinchi ustuni va jamoa sarlavhasi joyida qoladi | D |
| Natija belgisi | "G'alaba" `--positive`, "Mag'lubiyat" `--negative`, har doim so'z bilan | D |
| `MapTile` | xarita tusidagi kvadrat, 36 yoki 44px, chegarasi `--line-strong` | D |
| `MatchScore` | `team_A 13 : 9 team_B`: hisob "katta hisob" o'lchamida; g'olib `--foreground`; yutqazgan jamoaning hisobi `--subtle`, nomi `--muted-foreground` | D |
| `StatTile` | mono yorliq, mono 26px/600 qiymat, foizli ko'rsatkichda 3px chiziq (yo'li `--line-strong`, to'lgan qismi `--foreground`), 12px izoh; to'rt ustun, `lg` dan past ekranda ikki ustun; kataklar orasida 1px `--border` chiziq, atrofida shu chegara; ma'lumotsiz ko'rsatkich — `--subtle` rangli "—" (ekran o'quvchisiga "Ma'lumot yo'q"), sababi katak izohida ("Demo tahlili kerak", "Clutch urinishi yo'q") yoki to'r ostidagi qatorda (nechta match saqlangani) | 3-reja T6 (`StatsCards`) |
| Highlight kartasi | teg (ACE to'ldirilgan, qolganlari kontur; teg matni yozilganidek ko'rsatiladi: `4K`, `1v3 CLUTCH`, `NO-SCOPE`), `14-RAUND · T` (tomon o'z rangida; tomoni noma'lum bo'lsa tomonsiz), davomiylik `m:ss`; o'yinchi 17px/600 (profili bo'lsa havola; bosish maydoni 44px, fokus konturi esa ismning o'zi atrofida, chunki maydon qo'shni qatorlarga kirib boradi) va qisqa tavsif (`AK-47 ×5 · 3 headshot`); `KillTimeline`; bir necha matchni qamragan ro'yxatda pastda matchga havola qatori (xarita, sana, strelka); pastda amal yoki holat. Kartalar to'ri: bir, `sm` dan ikki, `xl` dan uch ustun | 3-reja T6 (amalsiz), 5-reja T6 (amal bilan) |
| `KillTimeline` | 2px yo'l (`--line-strong`); kill belgilari 2×16px `--rec`; klip oynasi — ikki yonida 2px och chegara va 8% och fon. Ikki rejim: raund ichidagi oyna (highlight kartasi) va klipning o'zi (pleyer ostidagi chiziq, 0:00 dan oxirigacha; belgi bosilsa video shu joyga o'tadi) | 3-reja T6, 5-reja T6 |
| `ViewfinderFrame` | 16:9 kadr, fon — xarita sahnasi; to'rt burchakda 2px och qavs (katta kadrda 18px, kartada 12px); joylar: yuqori-chap yorliq (`MIRAGE · R14`), yuqori-o'ng (kill feed yoki REC), markaz (o'ynatish tugmasi, foiz yoki holat), pastki-chap davomiylik, pastki-o'ng sifat | 5-reja T6 |
| `KillFeedRow` | mono 12px: killer (tomon rangida), qurol (`--muted-foreground`), headshot belgisi, qurbon (tomon rangida); 1px `--rec` chegara, fon 80% qora | 5-reja T6 |
| `StatusChip` | klip holati, mono 11px: `NAVBATDA · N-o'rin` (kulrang); `YOZILMOQDA n%` (miltillovchi `--rec` nuqta va `--rec` progress); `KODLANMOQDA`, `YUKLANMOQDA` (och); `TAYYOR` (`--positive`); `XATO` (`--negative`, sababi bilan) | 5-reja T6 |
| `RecorderStatus` | nuqta (`--positive` yoki kulrang) va "Yozuvchi onlayn · navbatda N" | 5-reja T6 (`RecorderBanner`) |
| Klip kartasi | `ViewfinderFrame`, sarlavha 15px/600, meta 13px, holat qatori va amal | 5-reja T6 |
| `RoundStrip` | har raundga ikki katak (yuqori — birinchi jamoa yutgan, pastki — ikkinchi), tomon rangida; 12-raunddan keyin oraliq; highlight bor raund ostida `--rec` nuqta | 9-reja |
| Tablar | 44px, faol tab ostida 2px och chiziq. Ro'yxatni filtrlaydigan tugmalar ham shu ko'rinishda (`aria-pressed` bilan), yonida mono 12px `--subtle` son | kerak bo'lgan rejada; 3-reja T6 (match highlight'lari filtri) |
| `DemoPanel` | bir qatorli panel: mono yorliq `DEMO`, holat tegi (tahlil qilingan — `positive`; xato yoki tahlili yiqilgan — `negative`; oraliq holatlar — `outline`; demo yo'q — `secondary`), o'ngda `ghost` tugma "Boshqarish". Xato sababi panel ichida alohida qatorda, mono 12px `--negative`. "Boshqarish" ochilganda: admin kaliti maydoni (kalit xotirada bo'lmasa), fayl tanlash va "Yuklash", "FACEIT'dan olish", "Qayta tahlil qilish" (`outline` tugmalar), ostida so'rov holati va natija matni. Yuklanayotganda — skeletonsiz, faqat mono yorliq matni (bir qatorli panelda skeletonga joy yo'q) | 3-reja T6; 6-rejada admin roli ortiga o'tadi |

## 4. Ekranlar

| Maketdagi ekran | Marshrut | Tarkibi | Qaysi reja beradi |
|-----------------|----------|---------|-------------------|
| 1 · Bosh sahifa | `/` (kirmagan foydalanuvchi) | hero (sarlavha, kadr, kill feed), uch qadam, klip turlari, statistika, chaqiriq | 5-reja T6 dan keyin (klip bo'lganda); kirish tugmalari — 6-reja |
| 2 · Matchlar | `/matches` | holat tablari, match qatorlari, yon panel (yozuvchi, demo yuklash, balans) | 6-reja T3–T4; balans — 8-reja |
| 3 · Match | `/matches/:matchId` | hisob paneli, raundlar, highlight kartalari, kompilyatsiya, scoreboard | D (panel, scoreboard); 3-reja T6 (highlight, demo); 5-reja T6–T7 (klip); 9-reja (raundlar) |
| 4 · Klip buyurtmasi | dialog | highlight xulosasi, sifat, Telegram, navbat, narx | 5-reja T6; Telegram — 7-reja; narx — 8-reja |
| 5 · Kliplar | `/clips` | yozuvchi holati, holat tablari, klip kartalari | 5-reja T6 |
| 6, 7 · Klip sahifasi | `/clips/:clipId` | pleyer va ostida kill belgili chiziq, amallar (yuklab olish, havola; Telegram — 7-reja), kill'lar ro'yxati, klip haqida | 5-reja T6; ommaviy ko'rinish va OG teglari — 11-reja |
| 8 · O'yinchi | `/players/:playerId` | sarlavha, KPI kataklari, xaritalar, highlight turlari, kliplar | D (sarlavha, match tarixi); 3-reja T6 (KPI, highlight); 5-reja T6 (kliplar); 9-reja (xaritalar) |
| (maketda yo'q) O'yinchi highlight'lari | `/players/:playerId/highlights` | o'yinchi kartasi (profilga havola), tur bo'yicha filtr (`<select>`, 44px), highlight kartalari, "Yana ko'rsatish" | 3-reja T6 |

Maketdagi ma'lumotlar namunaviy. Coin narxlari `[N]` — narx 8-rejada belgilanadi. Statistikada faqat 3-reja hisoblaydigan ko'rsatkichlar bor (K/D, HS%, ADR, KAST, entry, trade, clutch, g'alaba ulushi); rating ustuni 9-rejagacha yo'q.

## 5. Til va formatlar

- Interfeys ikki tilda: `uz` (standart) va `en`. Tanlov tepa paneldagi `UZ` / `EN` tugmalari bilan almashadi va brauzerda saqlanadi (`localStorage`, kalit `csfaceit.lang`). `ru` keyin qo'shiladi — lug'at tuzilishi shunga tayyor.
- Komponentlarda foydalanuvchiga ko'rinadigan matn to'g'ridan-to'g'ri yozilmaydi: hammasi `frontend/src/i18n/` lug'atlaridan.
- `en` lug'ati — interfeysning 2026-10-11 gacha bo'lgan inglizcha matni, so'zma-so'z (mavjud testlar shu matnga tayanadi).
- O'yin atamalari tarjima qilinmaydi: ACE, clutch, headshot, entry, trade, ADR, KAST, HS%, K/D.
- Sana: `uz` — `10-okt 2026`; `en` — `10 Oct 2026`. Soat 24 soatlik. Hisob `13 : 9`.

## 6. Mavjud sahifalarning oraliq ko'rinishi (D-reja)

Kirish, highlight va kliplar hali yo'q, shuning uchun D-reja faqat ishlab turgan narsani yangi ko'rinishga o'tkazadi; maketdagi qolgan bo'limlar o'z rejalarida qo'shiladi.

- **Tepa panel:** logo (bosh sahifaga havola) va til tugmalari. Navigatsiya bandlari, qidiruv maydoni, balans va avatar o'z rejalari bilan keladi.
- **Bosh sahifa (`/`):** hero uslubidagi qidiruv — mono yorliq, hero sarlavha, bir jumla izoh, nickname maydoni (52px) va "Qidirish" tugmasi (`lg`); pastida topilgan o'yinchi kartasi. Maketdagi marketing bo'limlari klip bo'lganda qo'shiladi.
- **O'yinchi (`/players/:playerId`):** sarlavha (avatar yoki bosh harf, nickname, mamlakat, ELO mono, daraja tegi) va match tarixi: har qator — sana (mono), natija so'zi (rangda), hisob (mono 19px/600, o'yinchining o'z raundlari birinchi: FACEIT hisobni jamoa tartibida beradi), o'ngda strelka; "Yana ko'rsatish" — `outline` tugma.
- **Match (`/matches/:matchId`):** panel — `MapTile`, xarita nomi (26px/1.2/600, harf oralig'i −0.02em, maketdagidek), mono qatorda xom xarita nomi, sana va holat (har biri alohida element), statistika kelgach `MatchScore`; ostida har jamoa uchun scoreboard paneli (jamoa nomi, g'olib tegi, hisob mono 22px/600).
- **404:** sahifa sarlavhasi va bosh sahifaga havola.

## 7. Qulaylik

- Tugma — `<button>`, o'tish — `<a>`, maydon — `<label>` bilan; ikonka tugmasida `aria-label`; bezak SVG `aria-hidden`.
- Maydonning nomi haqiqiy `<label>` (`htmlFor` va `id` bilan), `aria-label` emas; yorliq ko'rinmasa — `sr-only`. Placeholder nom o'rnini bosmaydi: yozilishi bilan yo'qoladi. Input chegarasi (`--border`) bezak: maydonni belgilovchi narsa u emas, yorlig'i va placeholder'i, shuning uchun uning past kontrasti ruxsat etiladi.
- Matn kontrasti kamida 4.5:1 (24px dan katta matnda 3:1). `--subtle` faqat `--background`, `--card` va `--secondary` ustida ishlatiladi.
- Klaviatura bilan har amalga yetib boriladi, fokus ko'rinadi.
- Harakat: faqat REC nuqtasining miltillashi (1.4 s); `prefers-reduced-motion` da o'chadi.
- Yuklanish holati: chegarali (1px `--border`) skeleton va uning ustida mono yorliq ko'rinishidagi yuklanish matni, `aria-live="polite"` bo'limi ichida; animatsiya yo'q.

## 8. Rejalarga ta'siri

- **3-reja T5:** highlight kartasi uchun `HighlightResponse` ga maydonlar qo'shildi: `side`, `roundStartTick`, `roundEndTick`, `durationSeconds`, `kills` (tick, qurol, headshot, qurbon).
- **3-reja T6:** `StatsCards` — `StatTile` ko'rinishida; `HighlightList` — highlight kartalari (rangli badge'lar o'rniga 3-bo'limdagi teglar); matnlar lug'atdan (ikki tilda); 2.2 dagi shrift rollaridan hozir komponentlarda inline yozilganlari (sahifa sarlavhasi, bo'lim sarlavhasi, mono raqam, katta hisob) `label-mono` yonidagi `@utility` sinflariga ko'tariladi. Shu vazifada qo'shilgani (2026-10-12): o'yinchi sahifasi konteynerning to'liq kengligida — sarlavha, "Statistika", "Highlight'lar" (so'nggi 10 ta va hammasiga havola), "Matchlar tarixi"; match sahifasida hisob panelidan keyin `DemoPanel`, highlight'lar (filtr bilan), so'ng scoreboard'lar.
- **5-reja T1:** klip sahifasi uchun `ClipResponse` ga `kills` (video vaqt chizig'idagi o'rni bilan) va `expiresAt` qo'shildi.
- **5-reja T6:** tayyor klip dialogda emas, o'z sahifasida ochiladi (`/clips/:clipId`) — havolasini ulashish mumkin bo'lishi uchun; sifat tanlovi alohida buyurtma dialogida; holatlar `StatusChip` bilan. Pleyer brauzerning o'z boshqaruvi bilan qoladi (to'liq ekran va telefon uchun), kill belgilari uning ostidagi `KillTimeline` da. Maketdagi kadr ustidagi kill feed — videoning o'zidagi tasvir, interfeys qatlami emas.
- **Keyinga qolgani:** "Kliplar" sahifasidagi holat tablari va "Mening" filtri — 6-reja (klip egaligi bilan); kompilyatsiya panelidagi ko'p segmentli chiziq va taxminiy davomiylik — 6-reja (oldindan hisoblash endpointi bilan); Telegram belgisi — 7-reja; narx va balans — 8-reja; raundlar chizig'i, xaritalar jadvali — 9-reja; buyurtma dialogida FPS pog'onasi (60–600), motion blur, ovoz, raqib ko'zidan ko'rsatish va skin tanlovi, har biri narxi bilan — 10-reja (narxlar 8-rejada).
- **6-rejadan boshlab:** har yangi ekran shu hujjatning 3–4-bo'limlariga ko'ra quriladi; yangi komponent kerak bo'lsa, avval shu hujjatga qo'shiladi.

## 9. Ochiq masalalar

- Mahsulot nomi: `csfaceit` — ishchi nom ("FACEIT" so'zi birovning savdo belgisi). Nom tanlangach logo yozuvi va sahifa sarlavhalari almashtiriladi.
- Bosh sahifaning marketing ko'rinishi kirish (6-reja) tayyor bo'lguncha ko'rsatiladimi — 5-reja oxirida hal qilinadi.
- `ru` tili va narxlar — tegishli rejalarda.
