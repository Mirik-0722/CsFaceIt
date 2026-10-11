# D-quyi loyiha: UI asosi ("A · REC" dizayni) — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sayt tanlangan "A · REC" dizayniga o'tadi: ranglar, shriftlar va asosiy komponentlar yangilanadi, tepa panel va footer paydo bo'ladi, mavjud uch sahifa (qidiruv, o'yinchi, match) yangi ko'rinishda chiqadi, interfeys o'zbekcha (standart) va inglizcha bo'ladi.

**Architecture:** Faqat `frontend/` o'zgaradi. Dizayn tokenlari `src/index.css` da (shadcn o'zgaruvchilari yangi qiymatlar bilan va bir necha yangi rang); `src/components/ui/*` shu tokenlar bo'yicha qayta bezatiladi, API'si saqlanadi. Matnlar `src/i18n/` lug'atlariga ko'chadi (provider'siz modul ombori, `useSyncExternalStore`). Sahifalar bitta `AppLayout` ichida chiziladi. Backend, parser va Compose'ga tegilmaydi; yangi API so'rovi yo'q.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind CSS 4 (`@theme inline`, `@utility`), shadcn/ui (base-nova), `@fontsource-variable/geist` va `@fontsource-variable/geist-mono`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-web-ui-design.md` (hammasi; ayniqsa 2, 3, 5, 6, 7-bo'limlar). Maket: <https://claude.ai/artifact/UuKDJd2gJ3hLVKbRL85qLk>.

**Branch:** `feature/ui-foundation`, `feature/highlights-stats` ning hozirgi uchidan. Reja tugagach `feature/highlights-stats` shu branch uchiga suriladi (fast-forward) va 3-reja o'sha yerda davom etadi.

## Global Constraints

- **Yangi test yozilmaydi** (foydalanuvchi qarori). Mavjud testlar (Vitest 120, Playwright 1) `en` tilida yashil qolishi shart. Mavjud test faqat tasdiqlangan dizayn tuzilishni o'zgartirgan joyda va eng kichik hajmda tahrirlanadi; har bir shunday tahrir hisobotda sababi bilan sanab o'tiladi. Avval belgini saqlab qolish yo'li izlanadi (masalan, `aria-label`), test tahriri — oxirgi chora.
- Qiymatlar spec'dan aynan olinadi: ranglar 2.1, shrift o'lchamlari 2.2, o'lchamlar 2.3. Hex qiymatlar faqat `src/index.css` va `src/lib/mapTint.ts` da; komponentlarda faqat token utility'lari (`bg-card`, `text-subtle`, `border-line-strong`, …).
- **Faqat to'q mavzu.** Yorug' mavzu qiymatlari va almashtirgich yo'q.
- **Qizil (`--rec`) qoidasi:** oq matn ostida fon bo'lmaydi; faqat nuqta, chiziq, chegara yoki matn rangi.
- **Matnlar faqat lug'atdan:** komponentlarda foydalanuvchiga ko'rinadigan matn (shu jumladan `aria-label`, `placeholder`, `sr-only`) to'g'ridan-to'g'ri yozilmaydi. `uz` — standart; `en` — hozirgi matnlarning so'zma-so'z nusxasi. O'yin atamalari tarjima qilinmaydi.
- Bosiladigan har element kamida 44px; matn kontrasti kamida 4.5:1; fokus ko'rinadi (spec 7).
- Yangi bog'liqlik faqat `@fontsource-variable/geist-mono`. Boshqa kutubxona (i18n, ikonka, animatsiya) qo'shilmaydi.
- Komponentlarning mavjud props'lari va sahifalarning xatti-harakati (validatsiya, so'rovlar, `aria-live` bo'limlari, sahifalash) o'zgarmaydi — bu reja ko'rinish va matn manbaini o'zgartiradi.
- `backend/`, `parser/`, `docker-compose*.yml`, `.env` ga tegilmaydi; `.env` o'qilmaydi. Hujjat tili o'zbekcha (ildiz `README.md` inglizcha); kod, izoh va commit matnlari inglizcha.

## Review Focus

Test yozilmagani uchun quyidagilar review'da kodni o'qib va egasi vazifaning "Tekshirish" qadamida skrinshotlar bilan tekshiriladi.

1. **Uzun matnlar:** 32 belgili nickname, uzun jamoa nomi, uzun xato matni 390px da ham joylashuvni buzmaydi va sahifani yonga surmaydi — matn kesiladi yoki o'raladi (Task 2, 3; `long` stsenariysi).
2. **Ma'lumot yo'q holatlar:** CS2 ma'lumotisiz o'yinchi (`elo`, `level`, `avatar`, `country` — `null`, match yo'q); davom etayotgan match (`mapName`, `startedAt`, `status` — `null`, statistika 404); jamoa nomi `null`; hisobi yo'q tarix qatori. Har biri bo'sh quti, `undefined` yoki `null` yozuvisiz chiqadi (Task 3; `empty` va `live` stsenariylari).
3. **Til:** almashtirish ko'rinib turgan hamma matnni darhol o'zgartiradi, sahifa yangilanganda saqlanadi, `<html lang>` yangilanadi; `localStorage` da noma'lum qiymat bo'lsa yoki `localStorage` ishlamasa — `uz`, xatosiz (Task 1, 2).
4. **Klaviatura va fokus:** har havola va tugmaga Tab bilan yetiladi, to'q fonda fokus halqasi ko'rinadi; qator-havolaning nomi natija va hisobni o'z ichiga oladi (Task 1–3; `focus` skrinshotlari).
5. **Tor ekran:** 390px da scoreboard o'z qutisi ichida suriladi, hero sarlavha so'z o'rtasidan sinmaydi, tepa panel va qidiruv formasi yangi qatorga tushadi (Task 2, 3).

---

## Fayl tuzilmasi

```
frontend/package.json                       # + @fontsource-variable/geist-mono            Task 1
frontend/index.html                         # lang, class="dark", title, theme-color        Task 1
frontend/src/index.css                      # tokenlar, shriftlar, utility'lar               Task 1
frontend/src/components/ui/{button,badge,card,input,table,skeleton}.tsx   # qayta bezash    Task 1
frontend/src/i18n/{index.ts,en.ts,uz.ts}    # lug'atlar va til ombori                        Task 1
frontend/src/lib/{formatDate,errorMessage,badgeStyles}.ts                 # til parametri   Task 1
frontend/src/test/setup.ts, frontend/playwright.config.ts                 # testlar `en` da  Task 1
frontend/e2e/shots.spec.ts, frontend/.gitignore                           # skrinshot vositasi Task 1
frontend/src/components/{Logo,LanguageSwitch,TopBar,Footer,AppLayout}.tsx # qobiq           Task 2
frontend/src/App.tsx, frontend/src/pages/{SearchPage,NotFoundPage}.tsx    #                 Task 2
frontend/src/lib/mapTint.ts, frontend/src/components/{MapTile,MatchScore}.tsx #             Task 3
frontend/src/components/{PlayerHeader,MatchList,StatsTable}.tsx           # qayta bezash    Task 3
frontend/src/pages/{PlayerPage,MatchPage}.tsx, README.md                  #                 Task 3
```

## Tekshirish muhiti

- Hamma buyruq `frontend/` ichida: `npm run lint`, `npm run build`, `npm test -- --run`, `npm run e2e`. Docker kerak emas: Playwright API'ni brauzerda soxtalashtiradi.
- **Skrinshotlar:** `SHOTS=1 npx playwright test e2e/shots.spec.ts` → `frontend/shots/*.png` (git-ignore). Implementer skrinshotlarni ochib ko'radi va spec bilan solishtiradi; reviewer ham ko'radi. Hisobotda fayl nomlari va ko'rilgan nuqsonlar yoziladi.
- Boshlashdan oldin `npm test -- --run` va `npm run e2e` bir marta ishga tushirilib, boshlang'ich sonlar (120 va 1) hisobotga yoziladi.
- Diskda joy kam (2026-10-11 da to'lib qolgan). Har vazifa boshida `df -h /System/Volumes/Data`: 300 MB dan kam bo'lsa ish to'xtatiladi va xabar beriladi; hech narsa o'chirilmaydi.

**Bajarish tartibi:** 1 → 2 → 3.

---

### Task 1: Tokenlar, shriftlar, asosiy komponentlar, ikki til, skrinshot vositasi

**Files:**
- Create: `frontend/src/i18n/index.ts`, `frontend/src/i18n/en.ts`, `frontend/src/i18n/uz.ts`, `frontend/e2e/shots.spec.ts`
- Modify: `frontend/package.json` (+lock), `frontend/index.html`, `frontend/src/index.css`, `frontend/src/components/ui/{button,badge,card,input,table,skeleton}.tsx`, `frontend/src/lib/{formatDate,errorMessage,badgeStyles}.ts`, `frontend/src/test/setup.ts`, `frontend/playwright.config.ts`, `frontend/.gitignore`; matni lug'atga ko'chadigan mavjud komponent va sahifalar (`App.tsx`, `pages/*`, `components/{PlayerHeader,MatchList,StatsTable}.tsx`) — bu vazifada faqat matn manbai almashadi, joylashuvi Task 2–3 da

**Interfaces:**
- `index.css`: `:root` da spec 2.1 dagi hamma o'zgaruvchi (shadcn nomlari yangi qiymat bilan; `--radius: 0.25rem`; `color-scheme: dark`); `.dark` bloki va yorug' qiymatlar olib tashlanadi, `index.html` da `<html lang="uz" class="dark">` (shadcn'ning `dark:` variantlari ishlashi uchun). `@theme inline` ga: `--color-subtle`, `--color-line-strong`, `--color-rec`, `--color-positive`, `--color-negative`, `--color-side-ct`, `--color-side-t`, `--font-mono: 'Geist Mono Variable', ui-monospace, monospace`. Utility'lar: `@utility label-mono` (mono 11px, 0.08em, bosh harflar, `--subtle`), `@utility container-page` (eng ko'pi 1280px, markazda, yon bo'shliq `clamp(16px, 4vw, 40px)`). `@keyframes rec` (1 → 0.3 → 1 shaffoflik) va `prefers-reduced-motion` da o'chirish. `body`: fon `--background`, 15px/1.5.
- `Button` (variant va o'lcham nomlari saqlanadi): `default` — fon `--primary`; `outline` — shaffof, chegarasi `--line-strong`; `ghost`; `link`. O'lchamlar: `default` 44px, yon 18px, 14px/600; `lg` 52px, yon 24px, 15px/600; `icon` 44×44; radius 4px. Qolgan o'lcham nomlari qoladi, lekin 44px dan past bo'lmaydi.
- `Badge`: spec 3 dagi teg (22px, mono 11px/600, 0.06em, bosh harflar CSS bilan — DOM matni o'zgarmaydi, radius 2px). Variantlar: `default`, `outline`, `secondary`, `positive` (yangi), `negative` (yangi), `destructive` = `negative`. `lib/badgeStyles.ts` dagi `WIN_BADGE_CLASS` yangi tokenlarga o'tadi (nomi saqlanadi).
- `Card` — fon `--card`, chegarasi `--border`, radius 0, soya yo'q. `Input` — 44px, fon `--card`, chegarasi `--border`, radius 4px. `Table` — sarlavha katagi `label-mono`, 36px; qator 44px, ustida `--border`; `Skeleton` — fon `--secondary`, radius 0.
- `i18n/index.ts`:
  - `type Locale = 'uz' | 'en'`; `LOCALES: readonly Locale[]` (`['uz', 'en']`); `DEFAULT_LOCALE = 'uz'`; `LOCALE_STORAGE_KEY = 'csfaceit.lang'`; `type Messages = typeof en`.
  - `getLocale(): Locale`; `setLocale(locale: Locale): void` (omborni yangilaydi, `localStorage` ga yozadi, `document.documentElement.lang` ni o'rnatadi, obunachilarga xabar beradi); `useLocale(): Locale` (`useSyncExternalStore`); `useT(): Messages`; `messagesFor(locale: Locale): Messages`.
  - Boshlang'ich til: `localStorage[LOCALE_STORAGE_KEY]` `LOCALES` ichida bo'lsa o'sha, aks holda `uz`; `localStorage` ga murojaat `try/catch` ichida. Provider yo'q — komponent o'rovsiz render qilinganda ham ishlaydi.
- `i18n/en.ts`: `export const en = { app, home, player, matchList, match, stats, errors, notFound, footer, language }` — qiymatlar hozirgi komponentlardagi matnlarning aynan o'zi; parametrli matn funksiya (`elo: (elo: number) => string`). `i18n/uz.ts`: `export const uz: Messages`. `uz` matnlari:

  | Kalit | `uz` |
  |-------|------|
  | `app.homeLink` (`en`: `CS2 FACEIT Analyzer`) | `Bosh sahifa` |
  | `home.eyebrow` (`en`: `CS2 · FACEIT analytics`) | `CS2 · FACEIT tahlili` |
  | `home.title` (`en`: `Player search`) | `O'yinchini toping.` |
  | `home.subtitle` (`en`: `Type a FACEIT nickname to see ELO, level and recent matches.`) | `FACEIT nickname'ini yozing: ELO, daraja va so'nggi matchlar bir joyda.` |
  | `home.nicknameLabel`, `home.placeholder` | `nickname`, `FACEIT nickname` |
  | `home.submit`, `home.searching` | `Qidirish`, `Qidirilmoqda…` |
  | `home.invalidNickname` | `Nickname 2–32 belgi bo'lsin: harf, raqam, _ yoki -` |
  | `player.title`, `player.history` | `O'yinchi`, `Matchlar tarixi` |
  | `player.loading`, `player.loadingMatches`, `player.loadMore` | `O'yinchi yuklanmoqda…`, `Matchlar yuklanmoqda…`, `Yana ko'rsatish` |
  | `player.elo(n)`, `player.level(n)`, `player.noCs2Data` | `{n} ELO`, `{n}-daraja`, `CS2 ma'lumoti yo'q` |
  | `matchList.win`, `matchList.loss`, `matchList.unknown`, `matchList.empty` | `G'alaba`, `Mag'lubiyat`, `Natija noma'lum`, `Hali match yo'q` |
  | `match.title`, `match.unknownMap` | `Match`, `Xarita noma'lum` |
  | `match.statsUnavailable`, `match.loading`, `match.loadingStats` | `Bu match uchun statistika hali yo'q.`, `Match yuklanmoqda…`, `Statistika yuklanmoqda…` |
  | `stats.team`, `stats.winner`, `stats.score`, `stats.player`, `stats.empty` | `Jamoa`, `G'olib`, `Hisob:`, `O'yinchi`, `O'yinchilar statistikasi yo'q` |
  | `errors.playerNotFound`, `errors.matchNotFound` | `O'yinchi topilmadi`, `Match topilmadi` |
  | `errors.faceitUnavailable`, `errors.generic` | `FACEIT vaqtincha ishlamayapti. Keyinroq urinib ko'ring.`, `Xatolik yuz berdi. Qayta urinib ko'ring.` |
  | `notFound.title`, `notFound.back` | `Sahifa topilmadi`, `Qidiruvga qaytish` |
  | `footer.disclaimer` (`en`: `Not affiliated with Valve, Steam or FACEIT. Counter-Strike is a trademark of Valve Corporation.`) | `Valve, Steam yoki FACEIT bilan bog'liq emas. Counter-Strike — Valve Corporation savdo belgisi.` |
  | `language.label` (`en`: `Language`) | `Til` |

  Ustun nomlari (`K`, `D`, `A`, `HS`, `K/D`, `ADR`) ikkala tilda bir xil.
- `formatDate(iso: string, locale: Locale = 'en'): string` — `en`: hozirgidek (`01 Oct 2026`); `uz`: `1-okt 2026`, oy qisqartmalari kodda (`yan, fev, mar, apr, may, iyn, iyl, avg, sen, okt, noy, dek`), ko'ruvchining vaqt zonasida.
- `errorMessage(error: Error, t: Messages = messagesFor('en')): string`; `PLAYER_NOT_FOUND_MESSAGE` va `MATCH_NOT_FOUND_MESSAGE` eksportlari qoladi (`en` matni).
- Testlar `en` da: `src/test/setup.ts` eng yuqorida `localStorage.setItem('csfaceit.lang', 'en')`; `playwright.config.ts` da `use.storageState` — `http://localhost:5173` uchun shu kalit `en`.
- `e2e/shots.spec.ts`: `SHOTS` muhit o'zgaruvchisi bo'lmasa `test.skip`. API `e2e/fixtures.ts` dagi javoblar bilan soxtalashtiriladi (`search-flow.spec.ts` dagi usul). Stsenariylar: `default`; `long` (32 belgili nickname, 32 belgidan uzun jamoa nomlari); `empty` (o'yinchi: `avatar`, `country`, `elo`, `level` — `null`, tarix bo'sh); `live` (match: `mapName`, `startedAt`, `finishedAt`, `winner` — `null`, `status: 'ONGOING'`, statistika 404 `MATCH_NOT_FOUND`); `focus` (har sahifada Tab uch marta bosilgandan keyin). Sahifalar: bosh sahifa (bo'sh va natija bilan), o'yinchi, match, 404. Kengliklar 1440 va 390; til `uz` (`default` stsenariysi `en` da ham). Fayl nomi: `shots/<stsenariy>-<sahifa>-<kenglik>-<til>.png`, to'liq sahifa. `shots/` `.gitignore` ga.

- [ ] **Step 1:** Bog'liqlik, tokenlar, `ui/*`, lug'atlar va til ombori, matnlarni lug'atga ko'chirish, `formatDate`/`errorMessage`, test sozlamalari, skrinshot vositasi.
- [ ] **Step 2: Tekshirish.** `npm run lint` va `npm run build` toza; `npm test -- --run` → 120 yashil; `npm run e2e` → 1 yashil (skrinshot spec'i o'tkazib yuborilgan). `SHOTS=1 npx playwright test e2e/shots.spec.ts` → fayllar chiqadi; ko'rib chiqiladi: (a) fon, matn va tugmalar spec ranglarida, yorug' fon qolmagan; (b) raqamlar va teglar mono shriftda (Geist Mono yuklangan — brauzer tarmoq jurnalida tashqi shrift so'rovi yo'q); (c) `uz` skrinshotlarida inglizcha matn qolmagan (o'yin atamalari va FACEIT'dan kelgan qiymatlardan tashqari), `en` da o'zbekcha matn yo'q; (d) `grep -rnE "#[0-9A-Fa-f]{6}" src --include=*.tsx` hech narsa topmaydi; (e) brauzer konsolida xato va ogohlantirish yo'q; (f) Review Focus 3: `localStorage` ga `csfaceit.lang = "xx"` yozilganda sahifa `uz` da ochiladi.
- [ ] **Step 3: Commit** — `feat(frontend): adopt the REC design tokens, restyle primitives and add uz/en dictionaries`

---

### Task 2: Qobiq, bosh sahifa va 404

**Files:**
- Create: `frontend/src/components/{Logo,LanguageSwitch,TopBar,Footer,AppLayout}.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/pages/{SearchPage,NotFoundPage}.tsx`; kerak bo'lsa `frontend/src/App.test.tsx` (eng kichik tahrir)

**Interfaces:**
- Consumes: Task 1 tokenlari, `ui/*`, `useT`, `useLocale`, `setLocale`, `LOCALES`.
- `Logo({ className }: { className?: string })` — spec 3: `viewBox="0 0 28 28"`, yo'l `M3 9V3h6M19 3h6v6M25 19v6h-6M9 25H3v-6` (2px, `currentColor`), doira `cx=14 cy=14 r=4.5` (`--rec`), 26px; yonida `csfaceit`, mono 15px/600, −0.02em. SVG `aria-hidden`.
- `LanguageSwitch()` — har til uchun `<button type="button" aria-pressed>` (`UZ`, `EN`; mono 12px, 0.08em, 44px), faol til `--foreground`, qolgani `--muted-foreground`; guruh nomi `t.language.label`.
- `TopBar()` — `<header>`, pastida `--border` chiziq, `container-page`, kamida 68px, `flex-wrap`: chapda bosh sahifaga havola (`Logo`, nomi `t.app.homeLink`), o'ngda `LanguageSwitch`. Navigatsiya bandlari bu rejada yo'q (spec 6).
- `Footer()` — tepada `--border` chiziq, `container-page`: `csfaceit · <joriy yil>` (mono 12px, `--subtle`) va `t.footer.disclaimer` (12px, `--subtle`).
- `AppLayout()` — `TopBar`, `<Outlet />` (bo'sh joyni egallaydi), `Footer`; eng kam balandlik ekran bo'yi. `App.tsx` da hamma marshrut shu layout ostida; eski sarlavha havolasi olib tashlanadi.
- `SearchPage` — spec 6: `container-page`, tepada 72px; `label-mono` (`t.home.eyebrow`), hero sarlavha (`t.home.title`, `text-wrap: balance`), izoh (18px, `--muted-foreground`, eng ko'pi 30em), forma (eng ko'pi 560px: `Input` 52px va `Button size="lg"`, tor ekranda ustma-ust), ostida natija bo'limi (mavjud `aria-live` qutisi, `PlayerHeader` havolasi). Xatti-harakat o'zgarmaydi.
- `NotFoundPage` — `container-page`, h1 (`t.notFound.title`), havola (`t.notFound.back`, tagiga chizilgan, 44px).

- [ ] **Step 1:** Komponentlar, layout, marshrutlar, ikki sahifa.
- [ ] **Step 2: Tekshirish.** `npm run lint`, `npm run build`, `npm test -- --run` (120), `npm run e2e` (1) yashil. Skrinshotlar qayta olinadi va ko'riladi: (a) tepa panel va footer har sahifada, 1440 va 390 da; (b) bosh sahifa spec 6 ga mos, forma 390 da ustma-ust va sahifa yonga surilmaydi; (c) `UZ`/`EN` bosilganda matnlar almashadi, sahifa yangilangach saqlanadi, `<html lang>` o'zgaradi (Playwright bilan bir martalik tekshiruv, natijasi hisobotda); (d) `long` stsenariysida natija kartasidagi 32 belgili nickname kartadan chiqmaydi; (e) `focus` skrinshotlarida fokus halqasi ko'rinadi; (f) 404 sahifasi layout ichida.
- [ ] **Step 3: Commit** — `feat(frontend): add the app shell and restyle the search and not-found pages`

---

### Task 3: O'yinchi va match sahifalari

**Files:**
- Create: `frontend/src/lib/mapTint.ts`, `frontend/src/components/{MapTile,MatchScore}.tsx`
- Modify: `frontend/src/components/{PlayerHeader,MatchList,StatsTable}.tsx`, `frontend/src/pages/{PlayerPage,MatchPage}.tsx`, `README.md`; kerak bo'lsa mavjud testlar va `e2e/search-flow.spec.ts` (eng kichik tahrir)

**Interfaces:**
- Consumes: Task 1–2 natijalari; `MatchResponse`, `MatchStatsResponse`, `TeamStatsResponse`, `PlayerResponse`, `MatchSummary` (`api/types.ts`, o'zgarmaydi).
- `lib/mapTint.ts`: `mapKey(mapName: string | null): string | null` (`de_mirage` → `mirage`); `mapTile(mapName: string | null): string` va `mapScene(mapName: string | null): string` (spec 2.1 jadvali, noma'lum xarita — "boshqa hammasi" qatori); `mapLabel(mapName: string | null): string | null` (`de_mirage` → `Mirage`).
- `MapTile({ mapName, size = 44 }: { mapName: string | null; size?: 36 | 44 })` — bezak (`aria-hidden`).
- `MatchScore({ teams }: { teams: TeamStatsResponse[] })` — aynan ikki jamoa bo'lsa: chapda birinchi jamoa nomi, o'rtada `13 : 9` ("katta hisob"), o'ngda ikkinchi jamoa nomi; g'olib `--foreground`, yutqazgan `--subtle`; tor ekranda nomlar hisob ostiga tushadi. Ikki jamoa bo'lmasa hech narsa chizmaydi.
- `PlayerHeader` — panel: avatar (rasm yoki bosh harf doirasi; sahifada 72px, qidiruv natijasida 56px), nickname (20px/600, kesiladi), mamlakat va ELO (`t.player.elo`, mono 12px, `--muted-foreground`), daraja (`Badge variant="outline"`, `t.player.level`); ma'lumot bo'lmasa `Badge variant="secondary"` (`t.player.noCs2Data`).
- `MatchList` — tuzilish saqlanadi (`ul > li > a`, ichida `time`, natija, hisob): qator kamida 56px, ostida `--border`, hover'da `--secondary`; sana mono 12px `--subtle`; natija so'zi (`t.matchList.win` — `--positive`, `t.matchList.loss` — `--negative`, noma'lum — `—` va `sr-only` matn); hisob mono 19px/600; o'ngda strelka (bezak).
- `StatsTable` — haqiqiy `<table>`, sarlavhasi (`caption`) tepada: jamoa nomi 16px/600, g'olib bo'lsa `Badge variant="positive"` (`t.stats.winner`), o'ngda hisob mono 22px/600 (`sr-only` `t.stats.score` bilan); panel ko'rinishi (spec 3 "Jadval"); nickname — o'yinchi sahifasiga havola; K qalin; K/D 1 dan past bo'lsa `--muted-foreground`; jadval `overflow-x: auto` quti ichida.
- `PlayerPage` — `container-page`, ichki ustun eng ko'pi 880px: h1 (`t.player.title`) saqlanadi, lekin `label-mono` ko'rinishida kichik yorliq bo'ladi — katta sarlavha vazifasini `PlayerHeader` dagi nickname bajaradi; so'ng `PlayerHeader`, bo'lim sarlavhasi (`t.player.history`, h2), `MatchList`, "Yana ko'rsatish" (`Button variant="outline"`).
- `MatchPage` — `container-page`: h1 (`t.match.title`) `label-mono` ko'rinishida; panel — `MapTile`, katta sarlavha `mapLabel(mapName)` yoki `t.match.unknownMap`, ostida mono qator: xom xarita nomi (`de_mirage`), sana va holat — har biri alohida elementda; statistika kelgach `MatchScore`. Panel ostida ikki `StatsTable` (orasi 24px). Yuklanish va xato holatlari mavjud mantiq bo'yicha, yangi ko'rinishda.
- `README.md` (inglizcha): "Frontend" qismiga uch jumla — dizayn spec'i va maket havolasi, ikki til va uning kaliti, skrinshot buyrug'i.

- [ ] **Step 1:** `mapTint`, `MapTile`, `MatchScore`, uch komponent va ikki sahifa, README.
- [ ] **Step 2: Tekshirish.** `npm run lint`, `npm run build`, `npm test -- --run` (120), `npm run e2e` (1) yashil; test tahrirlari bo'lsa sanab o'tiladi. Skrinshotlar ko'riladi: (a) o'yinchi va match sahifalari spec 6 ga mos, 1440 va 390 da; (b) `long`: nickname va jamoa nomlari kesiladi, scoreboard 390 da o'z qutisida suriladi, sahifa yonga surilmaydi (Playwright'da `document.documentElement.scrollWidth <= clientWidth` bir martalik tekshiruv); (c) `empty`: o'yinchi sarlavhasida bosh harf, "CS2 ma'lumoti yo'q" tegi, "Hali match yo'q"; (d) `live`: "Xarita noma'lum", sana va hisob yo'q, statistika o'rnida izoh, bo'sh quti yo'q; (e) g'olib jamoa tegi yashil konturda, yutqazgan jamoa hisobi xira; (f) `focus`: qator-havola va nickname havolasida fokus halqasi ko'rinadi; (g) konsolda xato yo'q.
- [ ] **Step 3: Commit** — `feat(frontend): restyle the player and match pages`

---

## O'z-o'zini tekshirish

- **Spec 2 (tokenlar):** Task 1. **Spec 3:** "D" belgili komponentlar — `Logo`, `Button`, `Badge`, `Input`, jadval (Task 1–3), natija belgisi (`MatchList`, Task 3), `MapTile`, `MatchScore` (Task 3). Qolgan komponentlar o'z rejalarida (spec 3 "Qachon" ustuni).
- **Spec 5 (til):** Task 1 (lug'at, ombor, sana), Task 2 (almashtirgich).
- **Spec 6 (oraliq ko'rinish):** tepa panel, bosh sahifa, 404 — Task 2; o'yinchi, match — Task 3.
- **Spec 7 (qulaylik):** Global Constraints va har vazifaning `focus` va 390px tekshiruvlari.
- **Spec 8:** 3-reja T6 va 5-reja T6 matnlari shu reja bilan birga yangilangan (o'z fayllarida).
- **Tiplar:** `Locale`, `Messages`, `useT`, `setLocale` — Task 1 da aniqlanadi, Task 2–3 da shu nomlar bilan ishlatiladi; `mapTile`/`mapScene`/`mapLabel` — Task 3.

## Bajarish paytidagi qarorlar (2026-10-12)

Reja matnidan farq qiladigan joylar; kod shu qarorlarga ko'ra yozilgan.

- `lib/badgeStyles.ts` (`WIN_BADGE_CLASS`) olib tashlandi: g'alaba va g'olib `Badge variant="positive"` va `text-positive` bilan beriladi. `PLAYER_NOT_FOUND_MESSAGE` va `MATCH_NOT_FOUND_MESSAGE` eksportlari olib tashlandi — ularni hech kim ishlatmas edi.
- `positive` va `negative` teglari chegarasi to'liq rangda (maketdagidek); jadval sarlavhasi kataklariga aniq vazn berildi.
- Bosh sahifa havolasining nomi: `csfaceit · <t.app.homeLink>`, `en` da `Home` — ko'rinadigan yozuv nomning ichida bo'lishi uchun (WCAG 2.5.3). `<title>` va `theme-color` Task 2 da qo'shildi.
- **Xatti-harakat o'zgarishi (Global Constraints'dan istisno):** match ro'yxatida hisob o'yinchi tomonidan ko'rsatiladi — o'z raundlari birinchi (natijadan aniqlanadi). Haqiqiy ma'lumotda g'alaba "11 : 13" ko'rinishida chiqqani uchun.
- Scoreboard: D va A xira; tor ekranda o'yinchi ustuni va jamoa sarlavhasi joyida qoladi; yutqazgan jamoaning nomi va hisobi faqat match hal bo'lganda xira (`StatsTable` ga ixtiyoriy `lost`); `PlayerHeader` ga ixtiyoriy `size`.
- Match holati (`FINISHED`, `ONGOING`) mono qatorda, teg emas.
- Task 3 ni controller o'zi alohida worktree'da yozdi (foydalanuvchi ko'rsatmasi), review alohida agentda o'tdi.

## Yakunlash

Uch vazifadan keyin butun branch bo'yicha yakuniy review, topilmalar bitta tuzatish to'lqini bilan yopiladi. So'ng yo'l xaritasiga holat yoziladi, `feature/highlights-stats` shu branch uchiga suriladi. Push — foydalanuvchi ochiq repozitoriy haqidagi savolga javob bergach.
