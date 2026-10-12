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
| Landing bo'limi sarlavhasi (h2) | `clamp(26px, 2.6vw, 34px)` / 1.15 / 600 / −0.02em |
| Landing yakuniy chaqiriq | `clamp(28px, 3.2vw, 44px)` / 1.08 / 600 / −0.03em |
| Karta sarlavhasi | 17px / 1.4 / 600 |
| Asosiy matn | 15px / 1.5 / 400 |
| Ikkilamchi matn | 13–14px / 1.5 |
| Mono yorliq | mono 11px, 0.08em, bosh harflar, `--subtle` |
| Mono raqam (jadval) | mono 13px |
| Katta hisob | mono `clamp(44px, 5vw, 64px)` / 1 / 600 |

Bir necha komponent ishlatadigan rollar `frontend/src/index.css` da `@utility` sinflari: `label-mono` (mono yorliq), `heading-page` (sahifa sarlavhasi), `heading-section` (bo'lim sarlavhasi), `number-mono` (mono raqam), `score-big` (katta hisob). Komponentda bu rollar qo'lda qayta yozilmaydi. Ikki landing sarlavhasi faqat bosh sahifada ishlatiladi, shuning uchun `@utility` emas: bo'lim sarlavhasi — `components/landing/SectionTitle`, yakuniy chaqiriq — o'z bo'limida.

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
| Highlight kartasi | teg (ACE to'ldirilgan, qolganlari kontur; teg matni yozilganidek ko'rsatiladi: `4K`, `1v3 CLUTCH`, `NO-SCOPE`; `NINJA_DEFUSE` turi `DEFUSE` yorlig'i bilan — qoida haqiqiy ninja defuse'ni ajrata olmaydi), `14-RAUND · T` (tomon o'z rangida; tomoni noma'lum bo'lsa tomonsiz), davomiylik `m:ss`; o'yinchi 17px/600 (profili bo'lsa havola; bosish maydoni 44px, fokus konturi esa ismning o'zi atrofida, chunki maydon qo'shni qatorlarga kirib boradi) va qisqa tavsif (`AK-47 ×5 · 3 headshot`); `KillTimeline`; bir necha matchni qamragan ro'yxatda pastda matchga havola qatori (xarita, sana, strelka); pastda amal yoki holat. Kartalar to'ri: bir, `sm` dan ikki, `xl` dan uch ustun | 3-reja T6 (amalsiz), 5-reja T6 (amal bilan) |
| `KillTimeline` | 2px yo'l (`--line-strong`); kill belgilari 2×16px `--rec`; klip oynasi — ikki yonida 2px och chegara va 8% och fon. Ikki rejim: raund ichidagi oyna (highlight kartasi) va klipning o'zi (pleyer ostidagi chiziq, 0:00 dan oxirigacha, balandligi 24px; belgi bosilsa video shu joyga o'tadi). Chiziq — yonidagi matnning rasmi, shuning uchun ekran o'quvchisidan yashirin va belgilariga klaviatura bilan kirilmaydi: klaviatura yo'li — klip sahifasidagi kill'lar ro'yxati, uning qatorlari ham videoni o'sha joyga o'tkazadi | 3-reja T6, 5-reja T6 |
| `ViewfinderFrame` | 16:9 kadr, fon — xarita sahnasi; to'rt burchakda 2px och qavs (katta kadrda 18px, kartada 12px); joylar: yuqori-chap yorliq (`MIRAGE · R14`; kompilyatsiyada `MIRAGE · MATCH`), yuqori-o'ng (kill feed yoki REC), markaz (o'ynatish belgisi, foiz yoki holat), pastki-chap davomiylik, pastki-o'ng sifat (yozilganidek: `1080p`). Videoning kadri (thumbnail) bo'lsa, sahna ustiga yotqiziladi va yorliqlar o'qilishi uchun tepasi va pasti qoraytiriladi; kadr yuklanmasa sahna qoladi | 5-reja T6 |
| `KillFeedRow` | mono 12px: killer (tomon rangida), qurol (`--muted-foreground`), headshot belgisi (ichida nuqtasi bor halqa), qurbon (tomon rangida); 1px `--rec` chegara, fon 80% qora. O'yin kill feed'ining rasmi, ma'lumot emas: ekran o'quvchisidan yashirin, tomon rangi o'yindagidek; 12px — standart, qo'llangan joy uni o'zgartira oladi (bosh sahifada 448px dan tor kadrda 9px) | bosh sahifa (2026-10-12): faqat shu sahifadagi kadr uchun (8-bo'limga qarang) |
| `StatusChip` | klip holati, mono 11px: `NAVBATDA · N-o'rin` (kulrang); `YOZILMOQDA n%` (miltillovchi `--rec` nuqta; progress chizig'i chip yonida yoki kadr ostida); `KODLANMOQDA`, `YUKLANMOQDA` (och); `TAYYOR` (`--positive`); `XATO` (`--negative`). Xato sababi chipning ichida emas, yonida: yozuvchining o'z matni, mono 11px `--subtle`, sig'masa qirqiladi (klip sahifasida to'liq). Foiz har so'rovda o'zgaradi, shuning uchun u e'lon qilinmaydigan qismda (`aria-live="off"`): ekran o'quvchisi holat so'zi o'zgarganini aytadi, foizni esa faqat o'qilganda | 5-reja T6 |
| `RecorderStatus` | nuqta (`--positive` yoki kulrang) va mono 12px qator: "Yozuvchi onlayn", yozilayotgan klip bo'lsa "yozilmoqda N", "navbatda N". Qismlar ` · ` bilan ajratilgan bitta matn (`Yozuvchi onlayn · yozilmoqda 1 · navbatda 2`): tor ekranda gapdek o'raladi, nuqta birinchi satr yonida qoladi. Yozuvchi ko'rinmasa: "Yozuvchi oflayn"; shu paytda klip kutayotgan bo'lsa "Yozuvchi kompyuter o'chiq, kliplar navbatda kutadi · navbatda N". Uch joyda: match sahifasidagi highlight'lar sarlavhasi ostida, kliplar sahifasi tepasida (chegarali qutida), buyurtma dialogida (yozuvchi o'chiq bo'lsa izoh) | 5-reja T6 (`RecorderBanner`) |
| Klip kartasi | `ViewfinderFrame` (markazda: tayyor klipda o'ynatish belgisi, yozilayotganda foiz va kadr ostida 3px `--rec` chiziq, boshqa holatda chegarali `StatusChip`), sarlavha 15px/600 (`4K · nickname`; kompilyatsiyada `Kompilyatsiya · nickname`), meta 13px (xarita, raund, sana), holat qatori (`StatusChip` va tayyor klipda hajm, xatoda sabab). **Butun karta — klip sahifasiga havola**, ichida tugma yo'q: maketdagi yuklab olish, qayta urinish va bekor qilish tugmalari kartada emas (yuklab olish va o'chirish — klip sahifasida, qayta urinish — highlight kartasida). To'r: bir, `sm` dan ikki, `lg` dan uch, `xl` dan to'rt ustun | 5-reja T6 |
| Highlight kartasidagi klip qatori (`ClipButton`) | kartaning oxirgi qatori, 44px: klip yo'q — to'ldirilgan tugma `● Klip yozish`; navbatda yoki yozilmoqda — `StatusChip` (yozilayotganda yonida 2px progress chizig'i), qator klip sahifasiga havola; tayyor — kontur tugma `▶ Ko'rish` va `TAYYOR · 1080p`; xato — `XATO`, sababi va `Qayta urinish`. Har turdagi highlight uchun bor. Match sahifasida bunday qatorlar o'nlab bo'ladi, shuning uchun tugma va havolaning nomiga nimaniki ekani qo'shiladi (`Klip yozish: 4K · nickname · 14-raund`; nom ko'rinib turgan so'z bilan boshlanadi). Matchning kliplari kelguncha qator bo'sh turadi (44px joyi saqlanadi), karta keyin o'smaydi | 5-reja T6 |
| Klip buyurtmasi dialogi (`ClipOrderDialog`) | 560px gacha panel (`--card`, chegarasi `--line-strong`), sahifa ustida 80% qoraytirilgan fon; telefonda ekran kengligida, baland bo'lsa ichida suriladi; animatsiyasiz. Tarkibi: sarlavha va yopish tugmasi; nima yozilishi (highlight kartasining qisqa ko'rinishi yoki kompilyatsiyada o'yinchi va xarita); sifat — ikki radio quti (`720p` "Tezroq, kichikroq fayl", `1080p` "Tavsiya etiladi", standart `1080p`; tanlangani och chegarada); admin kaliti maydoni (sahifada kalit bo'lmasa; 6-rejagacha); navbat ("sizdan oldin N ta klip") va yozuvchi o'chiq bo'lsa izoh; so'rov holati va xato matni; `Bekor qilish` va `● Yozishni boshlash`. So'rov ketayotganda dialog yopilmaydi (yopish tugmasi va `Bekor qilish` o'chirilgan, Escape va tashqariga bosish ta'sir qilmaydi): so'rovni qaytarib bo'lmaydi, javobi esa (kalit noto'g'ri, navbat to'la) shu yerda ko'rsatiladi | 5-reja T6–T7 |
| Kompilyatsiya paneli | chegarali panel: sarlavha 17px/600, bir jumla izoh, o'yinchi tanlovi (`<select>`, 44px: scoreboard o'yinchilari, so'ng faqat highlight'larda uchraydiganlar) va kontur tugma `● Kompilyatsiya yozish` (o'yinchi tanlanmaguncha o'chirilgan); tanlangan o'yinchining kompilyatsiyasi bo'lsa tugma o'rnida uning holati (highlight kartasidagidek). Demo parse qilingandan keyin ko'rinadi | 5-reja T7 |
| `RoundStrip` | har raundga ikki katak (yuqori — birinchi jamoa yutgan, pastki — ikkinchi), tomon rangida; 12-raunddan keyin oraliq; highlight bor raund ostida `--rec` nuqta | 9-reja |
| Tablar | 44px, faol tab ostida 2px och chiziq. Ro'yxatni filtrlaydigan tugmalar ham shu ko'rinishda (`aria-pressed` bilan), yonida mono 12px `--subtle` son | kerak bo'lgan rejada; 3-reja T6 (match highlight'lari filtri) |
| `DemoPanel` | bir qatorli panel: mono yorliq `DEMO`, holat tegi (tahlil qilingan — `positive`; xato yoki tahlili yiqilgan — `negative`; oraliq holatlar — `outline`; demo yo'q — `secondary`), o'ngda `ghost` tugma "Boshqarish". Xato sababi panel ichida alohida qatorda, mono 12px `--negative`. "Boshqarish" ochilganda: admin kaliti maydoni (kalit xotirada bo'lmasa), fayl tanlash va "Yuklash", "FACEIT'dan olish" (`PARSED` va `ANALYZED` demoda ko'rinmaydi — backend uni e'tiborsiz qoldiradi; navbatdagi yoki saqlangan demoda qoladi, chunki o'n daqiqa qimirlamagan demoni qayta jonlantiradi), "Tahlil qilish" (`PARSED`) yoki "Qayta tahlil qilish" (`ANALYZED`) (`outline` tugmalar), ostida so'rov holati va natija matni. Yuklanayotganda — skeletonsiz, faqat mono yorliq matni (bir qatorli panelda skeletonga joy yo'q) | 3-reja T6; 6-rejada admin roli ortiga o'tadi |

## 4. Ekranlar

| Maketdagi ekran | Marshrut | Tarkibi | Qaysi reja beradi |
|-----------------|----------|---------|-------------------|
| 1 · Bosh sahifa | `/` (kirmagan foydalanuvchi; kirish 6-rejada kelguncha — hamma) | hero: `lg` dan ikki ustun, undan tor ekranda ketma-ket. Chap ustun — mono yorliq, hero sarlavha, bir jumla izoh va qidiruv (maydon, tugma, pastida topilgan o'yinchi kartasi): qidiruv hero'ning chaqiriq tugmasi. O'ng ustun — "Namuna" yorlig'i, katta `ViewfinderFrame` Mirage tusida (yuqori-chapda `REC 00:11:42`, yuqori-o'ngda besh qatorli kill feed, markazda nishon, pastda `MIRAGE · 14-RAUND` va `1080p · 60 FPS`), ostida klip chizig'i (`KillTimeline`, 0:00–0:16, besh kill) va izoh (`ACE` tegi, `temur1k · AK-47 ×5 · 3 headshot`, `0:16 · 21.4 MB · MP4`); butun rasm ekran o'quvchisidan yashirin. Uch qadam (`md` dan uch ustun): 01 demo keladi (`mirage_10-okt.dem` va "Tahlil qilindi" qatori), 02 highlight'lar topiladi (`ACE`, `4K`, `1v3 CLUTCH`, `NO-SCOPE`), 03 klip yoziladi (`StatusChip`lar: navbatda → yozilmoqda → tayyor; kartada "Tez orada" tegi). Ikki xil klip (`lg` dan ikki ustun): highlight klipi (oynali `KillTimeline` va mahsulotdagi har bir highlight turining tegi) va kompilyatsiya (ko'p segmentli chiziq, ikki belgili izoh: kill va videoga kiradigan qism). Statistika: yorliq, sarlavha, izoh, uch band va yonida namunaviy scoreboard (o'yinchi, K, D, ADR, HS%, KAST; sarlavhasida `MIRAGE · 13 : 11` va "Namuna"; ekran o'quvchisidan yashirin). Chaqiriq: bir jumla va "O'yinchini qidirish" tugmasi (qidiruv maydoniga fokus beradi va uni ko'rinishga olib keladi) | qidiruv atrofida 2026-10-12 da qurildi (8-bo'lim); kirish tugmalari — 6-reja |
| 2 · Matchlar | `/matches` | holat tablari, match qatorlari, yon panel (yozuvchi, demo yuklash, balans) | 6-reja T3–T4; balans — 8-reja |
| 3 · Match | `/matches/:matchId` | hisob paneli, raundlar, highlight kartalari, kompilyatsiya, scoreboard | D (panel, scoreboard); 3-reja T6 (highlight, demo); 5-reja T6–T7 (klip); 9-reja (raundlar) |
| 4 · Klip buyurtmasi | dialog | highlight xulosasi, sifat, Telegram, navbat, narx | 5-reja T6; Telegram — 7-reja; narx — 8-reja |
| 5 · Kliplar | `/clips` | sahifa sarlavhasi, yozuvchi holati, tayyor kliplar to'ri (yangisi birinchi), "Yana ko'rsatish"; holat tablari — 6-reja | 5-reja T6 |
| 6, 7 · Klip sahifasi | `/clips/:clipId` | ikki ustun (tor ekranda ketma-ket). Asosiy ustun: pleyer (16:9, brauzerning o'z boshqaruvi) va ostida kill belgili chiziq; sarlavha 26px (`ACE · AK-47 · Mirage`: tur, eng ko'p ishlatilgan qurol, xarita); o'yinchi (profili bo'lsa havola), matchga havola, raund va sana; amallar: "Yuklab olish" (to'ldirilgan, hajmi bilan), "Havolani nusxalash" (kontur; bosilgach "Havola nusxalandi"), admin kaliti sahifada bo'lsa "O'chirish" (ikkinchi bosish bilan tasdiqlanadi; yozilayotgan klipda yo'q); "Kill'lar" ro'yxati (vaqt, qurbon, qurol, `HEADSHOT`; tayyor klipda qator — videoni o'sha joyga o'tkazadigan tugma). Yon ustun: "Klip haqida" (sifat va FPS, davomiylik, hajm, yozilgan vaqt, qachongacha saqlanishi) va "Shu matchdan" (o'sha matchning boshqa kliplari: kichik kadr, nom, o'yinchi va raund, holat). Video hali bo'lmasa pleyer o'rnida xarita kadri: yozilayotganda katta foiz va kadr ostida progress, holat chipi, xatoda sababi | 5-reja T6; Telegram — 7-reja; ommaviy ko'rinish va OG teglari — 11-reja |
| 8 · O'yinchi | `/players/:playerId` | sarlavha, KPI kataklari, xaritalar, highlight turlari, kliplar | D (sarlavha, match tarixi); 3-reja T6 (KPI, highlight); 5-reja T6 (kliplar); 9-reja (xaritalar) |
| (maketda yo'q) O'yinchi highlight'lari | `/players/:playerId/highlights` | o'yinchi kartasi (profilga havola), tur bo'yicha filtr (`<select>`, 44px), highlight kartalari, "Yana ko'rsatish" | 3-reja T6 |

Maketdagi ma'lumotlar namunaviy. Coin narxlari `[N]` — narx 8-rejada belgilanadi. Statistikada faqat 3-reja hisoblaydigan ko'rsatkichlar bor (K/D, HS%, ADR, KAST, entry, trade, clutch, g'alaba ulushi); rating ustuni 9-rejagacha yo'q.

## 5. Til va formatlar

- Interfeys ikki tilda: `uz` (standart) va `en`. Tanlov tepa paneldagi `UZ` / `EN` tugmalari bilan almashadi va brauzerda saqlanadi (`localStorage`, kalit `csfaceit.lang`). `ru` keyin qo'shiladi — lug'at tuzilishi shunga tayyor.
- Komponentlarda foydalanuvchiga ko'rinadigan matn to'g'ridan-to'g'ri yozilmaydi: hammasi `frontend/src/i18n/` lug'atlaridan.
- `en` lug'ati — interfeysning 2026-10-11 gacha bo'lgan inglizcha matni, so'zma-so'z (mavjud testlar shu matnga tayanadi); istisno — bosh sahifa hero'sining uch matni (`home.eyebrow`, `title`, `subtitle`), 2026-10-12 da landing uchun qayta yozilgan (8-bo'limga qarang).
- O'yin atamalari tarjima qilinmaydi: ACE, clutch, headshot, entry, trade, ADR, KAST, HS%, K/D.
- Sana: `uz` — `10-okt 2026`; `en` — `10 Oct 2026`. Soat 24 soatlik. Hisob `13 : 9`.

## 6. Mavjud sahifalarning oraliq ko'rinishi (D-reja)

Kirish, highlight va kliplar hali yo'q, shuning uchun D-reja faqat ishlab turgan narsani yangi ko'rinishga o'tkazadi; maketdagi qolgan bo'limlar o'z rejalarida qo'shiladi.

- **Tepa panel:** logo (bosh sahifaga havola) va til tugmalari; 5-reja T6 dan boshlab birinchi navigatsiya bandi — "Kliplar" (44px, joriy sahifada ostida 2px och chiziq va och matn). Qolgan bandlar, qidiruv maydoni, balans va avatar o'z rejalari bilan keladi.
- **Bosh sahifa (`/`):** qidiruv atrofida qurilgan landing (4-bo'limdagi 1-qator). Hero'ning chap ustuni avvalgidek: mono yorliq, hero sarlavha, bir jumla izoh, nickname maydoni (52px) va "Qidirish" tugmasi (`lg`); pastida topilgan o'yinchi kartasi. Qidiruv hero'ning chaqiriq tugmasi, shuning uchun maketdagi "Steam bilan kirish" va "Demo yuklash" tugmalari yo'q. `lg` dan o'ng ustunda namunaviy kadr turadi, undan tor ekranda — qidiruvdan keyin; pastida uch qadam, ikki xil klip, statistika va yakuniy chaqiriq. Sahifa ichidagi amal — `<button>`: topilgan o'yinchi kartasidan boshqa havola yo'q. Klaviatura tartibi: nickname maydoni, "Qidirish", topilgan kartaga havola, sahifa oxiridagi "O'yinchini qidirish".
- **O'yinchi (`/players/:playerId`):** sarlavha (avatar yoki bosh harf — rasm yuklanmasa ham bosh harf, nickname, mamlakat, ELO mono, daraja tegi) va match tarixi: har qator — sana (mono), natija so'zi (rangda), hisob (mono 19px/600, o'yinchining o'z raundlari birinchi: FACEIT hisobni jamoa tartibida beradi), o'ngda strelka; "Yana ko'rsatish" — `outline` tugma.
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
- **3-reja T6:** `StatsCards` — `StatTile` ko'rinishida; `HighlightList` — highlight kartalari (rangli badge'lar o'rniga 3-bo'limdagi teglar); matnlar lug'atdan (ikki tilda); 2.2 dagi shrift rollaridan hozir komponentlarda inline yozilganlari (sahifa sarlavhasi, bo'lim sarlavhasi, mono raqam, katta hisob) `label-mono` yonidagi `@utility` sinflariga ko'tariladi. Shu vazifada qo'shilgani (2026-10-12): o'yinchi sahifasi konteynerning to'liq kengligida — sarlavha, "Statistika", "Highlight'lar" (so'nggi 6 ta — bir, ikki va uch ustunli to'rni to'ldiradi — va hammasiga havola), "Matchlar tarixi"; match sahifasida hisob panelidan keyin `DemoPanel`, highlight'lar (filtr bilan), so'ng scoreboard'lar.
- **5-reja T1:** klip sahifasi uchun `ClipResponse` ga `kills` (video vaqt chizig'idagi o'rni bilan) va `expiresAt` qo'shildi.
- **5-reja T6:** tayyor klip dialogda emas, o'z sahifasida ochiladi (`/clips/:clipId`) — havolasini ulashish mumkin bo'lishi uchun; sifat tanlovi alohida buyurtma dialogida; holatlar `StatusChip` bilan. Pleyer brauzerning o'z boshqaruvi bilan qoladi (to'liq ekran va telefon uchun), kill belgilari uning ostidagi `KillTimeline` da. Maketdagi kadr ustidagi kill feed — videoning o'zidagi tasvir, interfeys qatlami emas. Shu vazifada qo'shilgani (2026-10-12): "Klip yozish" tugmasi admin kalitisiz ham bosiladi — kalitni buyurtma dialogining o'zi so'raydi (demo panelidagidek: to'g'ri kalit sahifa yangilanguncha eslab qolinadi, rad etilgani unutiladi), chunki demo paneli kalitni faqat demo amali muvaffaqiyatli bo'lganda saqlaydi; dialogda sifat yonida FPS yozilmaydi (u server sozlamasi, klip sahifasida ko'rsatiladi); match sahifasida highlight'lardan keyin kompilyatsiya paneli va shu matchning kliplari bo'limi (klip bo'lsa), o'yinchi sahifasida "Kliplar" bo'limi; `KillFeedRow` komponenti qurilmadi (u faqat marketing bosh sahifasidagi kadr uchun kerak). Vazifa review'idan keyin klip sahifasiga qo'shilgani: sahifa ochiq turganda klip o'chirilsa (navbatdagi klipni qaytarib olish mumkin), sahifa eski holatni ko'rsatmaydi — "Klip topilmadi" deydi va so'rashni to'xtatadi; o'chirishni tasdiqlash savoli chiqqanda fokus `Qoldirish` tugmasiga o'tadi (savol — guruhning nomi), `Qoldirish` bosilganda `O'chirish` ga qaytadi; o'chirishda admin kaliti rad etilsa, kalit unutiladi va sahifa "Admin kaliti noto'g'ri" deydi; video yuklanmasa pleyer ostida "Videoni yuklab bo'lmadi…" chiqadi (yuklab olish havolasi qoladi); havola nusxalanmasa tugma ikki soniya "Havolani nusxalab bo'lmadi" deydi.
- **Bosh sahifa (landing, 2026-10-12):** `/` maketdagi bo'limlar bilan to'ldirildi (4-bo'limdagi 1-qator, 6-bo'lim). Bu 9-bo'limda ochiq turgan savolga javob edi ("marketing ko'rinishi kirish tayyor bo'lguncha ko'rsatiladimi"): ha, hamma uchun ko'rsatiladi, kirish tugmalari 6-rejada shu yerga qo'shiladi. Qurilgani: `KillFeedRow` (3-bo'lim) va `components/landing/` ostida hero kadri, uch qadam, ikki xil klip, statistika bilan namunaviy scoreboard va yakuniy chaqiriq; matnlar `home.*` lug'atlarida (ikki tilda), o'yin atamalari, teglar, nickname'lar va raqamlar koddagi belgi sifatida. `en` lug'atidagi `home.eyebrow`, `title` va `subtitle` yangi matn — 5-bo'limdagi "so'zma-so'z" qoidasidan istisno (eski sarlavha "Player search" endi yo'q). Kompilyatsiya chizig'i `KillTimeline` ko'rinishida, lekin bir nechta oynali: `KillTimeline` bitta oyna chizadi, shuning uchun u hozircha faqat shu sahifaga tegishli (6-rejadagi kompilyatsiya paneli ko'p segmentli chiziqni `KillTimeline` ga qo'shishi mumkin). Maketdan ataylab farqi — mahsulotda yo'q narsani va'da qilmaslik uchun: "Steam bilan kirish" va "Demo yuklash" tugmalari, "bepul coin" qatori, Telegram eslatmasi va "Xaritalar bo'yicha natija" bandi yo'q; 3-qadam kartasida "Tez orada" tegi bor (klip yozish tashrifchilarga hali ochiq emas); namunaviy kadr va scoreboard yonida "Namuna" yorlig'i bor, nickname'lar faqat maketdagilar (to'qima). Qolgan farqlari: highlight klipi kartasida maketdagi bitta "1v1–1v5 CLUTCH" tegi o'rniga mahsulotning har bir turi (13 ta) `highlightLabel` bo'yicha (`NINJA DEFUSE` o'rniga `DEFUSE`, `SMOKE ORQALI` o'rniga `TUTUN ORQALI`); tepa panelga maketdagi "Qanday ishlaydi", "Klip turlari", "Statistika" bandlari va "Kirish" tugmasi qo'shilmadi; uch qadam `md` dan uch ustun (maketdagi `auto-fit` taxminan 700–1040px da "2+1" qilib bo'sh joy qoldiradi); scoreboard maketdagi 460px minimal kengliksiz, 320px da ham surilmasdan sig'adi, sarlavhasida jamoa nomi yo'q; 448px dan tor kadrda yorliqlar 9px, kill feed kichraygan va REC yorlig'i ostiga tushadi (yonma-yon sig'masdi), 480px dan tor kadrda nishon qo'yilmaydi (feed bilan ustma-ust tushadi).
- **Keyinga qolgani:** "Kliplar" sahifasidagi holat tablari va "Mening" filtri — 6-reja (klip egaligi bilan); kompilyatsiya panelidagi ko'p segmentli chiziq va taxminiy davomiylik — 6-reja (oldindan hisoblash endpointi bilan); Telegram belgisi — 7-reja; narx va balans — 8-reja; bosh sahifadagi "Steam bilan kirish" va "Demo yuklash" tugmalari — 6-reja, "bepul coin" qatori — 8-reja, 3-qadamdagi "Tez orada" tegi klip yozish tashrifchilarga ochilganda olib tashlanadi; raundlar chizig'i, xaritalar jadvali — 9-reja; buyurtma dialogida FPS pog'onasi (60–600), motion blur, ovoz, raqib ko'zidan ko'rsatish va skin tanlovi, har biri narxi bilan — 10-reja (narxlar 8-rejada).
- **6-rejadan boshlab:** har yangi ekran shu hujjatning 3–4-bo'limlariga ko'ra quriladi; yangi komponent kerak bo'lsa, avval shu hujjatga qo'shiladi.

## 9. Ochiq masalalar

- Mahsulot nomi: `csfaceit` — ishchi nom ("FACEIT" so'zi birovning savdo belgisi). Nom tanlangach logo yozuvi va sahifa sarlavhalari almashtiriladi.
- `ru` tili va narxlar — tegishli rejalarda.
