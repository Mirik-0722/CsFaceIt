# 8-reja: Telefon ko'rinishi — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 768 px'dan tor ekranda pastki navigatsiya paneli, ikki qatorli matchlar qatori va ro'yxat ko'rinishidagi highlight/klip kartochkalari; kompyuter ko'rinishi o'zgarmaydi.

**Architecture:** Faqat frontend. Har o'zgarish o'sha komponentning o'zida, `max-md:` Tailwind variantlari bilan qilinadi: bitta DOM, interaktiv element (havola, tugma) ikki marta chizilmaydi. Yangi komponent bitta — `BottomNav`; uning bandlari sof funksiyadan (`lib/bottomNav.ts`) olinadi. Panellar balandligi CSS o'zgaruvchilari orqali boshqa vazifalarga beriladi.

**Tech Stack:** React 19, TypeScript, Tailwind v4, React Router, TanStack Query, Playwright (shots).

**Spec:** `docs/superpowers/specs/2026-10-15-phone-ui-design.md` (ma'qullangan); UI shartnomasi `docs/superpowers/specs/2026-10-11-web-ui-design.md`. Maketlar: https://claude.ai/artifact/3f14tCAcJ5UfQHkeksp3v8 (artboard'lar `Main`, `RowsA`, `CardsA`).

## Global Constraints

- Faqat `max-md` (< 768 px) o'zgaradi; `md` va undan kengda 1440 px rasmlari ish boshidagi asos rasmlari bilan bir xil bo'lishi kerak.
- Yangi test yozilmaydi (foydalanuvchi qarori); mavjudlari yashil: lint, build, Vitest 120, e2e.
- Avval UI shartnomasiga (`2026-10-11-web-ui-design.md`) o'zbekcha qatorlar, keyin kod.
- Matnlar `uz` va `en`da; tokenlar faqat `index.css`dagilar (`--rec`, `--positive`, `--negative`, `--faceit`, `--side-ct`, `--side-t`, `--hl-*`, `--subtle`, `--border`, `--card`).
- Bosiladigan joylar ≥ 44 px; ikonkali tugmada `aria-label`; ikonkalar — chiziqli inline SVG yoki mavjud `lucide-react`, emoji yo'q.
- Bitta DOM: bir havola yoki tugma telefon va kompyuter uchun ikki nusxada chizilmaydi.
- Misollar va shots ma'lumotlarida faqat o'ylab topilgan nik va SteamID.

## Review Focus

1. **Pastki panel kontentni yopishi** — ro'yxatning oxirgi qatori, footer'dagi ogohlantirish, dialog tugmalari, "Yana ko'rsatish" pastki panel ostida qolmasligi kerak (Task 1: sahifa oxirigacha aylantirilgan 390 rasmlari).
2. **Langar havolalar yopishqoq panellar ostiga tushishi** — match sahifasida "Scoreboard" tabi bosilganda bo'lim sarlavhasi yuqori panel + tablar ostida yashirinmasligi kerak (Task 3: `scroll-padding-top` va `#scoreboard` holati rasmi).
3. **Uzun matnlar** — uzun nik, uzun xarita nomi, 5+ highlight tegi 360 va 390 px'da qatorni sindirmasligi, gorizontal aylantirish chiqmasligi kerak (Task 2, 3: mavjud `long` holati 390 rasmlari + 360 px bitta rasm).
4. **Kirgan, lekin o'yinchisi yo'q foydalanuvchi** (`playerId` va `steamId` ikkalasi `null`) — pastki panel ishlashi, bo'sh yoki buzuq havola chiqmasligi kerak (Task 1: `bottomNavItems` qoidasi va shots holati).
5. **Klaviatura bilan yurish** — Tab tartibi: yuqori panel → kontent → footer → pastki panel; ochilgan qidiruv Esc bilan yopilib, fokus qidiruv tugmasiga qaytishi kerak (Task 1: qo'lda tekshiruv qadami).

---

## Fayllar

| Fayl | Vazifa | O'zgarish |
|---|---|---|
| `frontend/src/lib/bottomNav.ts` | 1 | Yangi: bandlar qoidasi (sof funksiya) |
| `frontend/src/components/BottomNav.tsx` | 1 | Yangi: pastki panel |
| `frontend/src/components/TopBar.tsx`, `TopBarSearch.tsx`, `AccountMenu.tsx`, `Footer.tsx`, `LanguageSwitch.tsx`, `AppLayout.tsx` | 1 | Telefon yuqori paneli, qidiruv tugmasi, til joyi, pastki joy |
| `frontend/src/index.css` | 1 | `--top-bar-h`, `--bottom-nav-h`, `max-md` scroll-padding |
| `frontend/src/components/MatchesTable.tsx`, `MatchList.tsx`, `pages/MatchesPage.tsx` | 2 | Ikki qatorli qator, aylanadigan filtr |
| `frontend/src/components/HighlightCard.tsx`, `ClipCard.tsx`, `pages/MatchPage.tsx` | 3 | Ro'yxat qatorlari, ixcham sarlavha, yopishqoq tablar |
| `frontend/src/i18n/uz.ts`, `en.ts`, `frontend/e2e/shots.spec.ts`, `docs/superpowers/specs/2026-10-11-web-ui-design.md` | 1–3 | Har vazifa o'z blokida |

Vazifalar 1, 2, 3 bir-biriga bog'liq emas (3 faqat `--top-bar-h` ni ishlatadi, uning qiymati 56px — Task 1 yo'q paytida ham `index.css`dagi standart qiymat bilan ishlaydi); parallel worktree'larda bajarilishi mumkin. Umumiy fayllarda (`uz.ts`, `en.ts`, `shots.spec.ts`, UI shartnomasi) har vazifa o'z alohida blokini qo'shadi. Birlashtirish tartibi: 1 → 2 → 3.

**Asos rasmlari (controller, ish boshida):** `main`da `npm --prefix frontend run shots -- -g "-1440-(uz|en)$"`, natijani `.superpowers/sdd/2026-10-16-08-telefon/baseline-1440/` ga ko'chiradi. Har vazifa o'z sahifalarining 1440 rasmlarini shular bilan piksel bo'yicha solishtiradi (`cmp` yoki `npx pixelmatch` — farq 0).

---

### Task 1: Navigatsiya — pastki panel va bir qatorli yuqori panel

**Files:**
- Create: `frontend/src/lib/bottomNav.ts`, `frontend/src/components/BottomNav.tsx`
- Modify: `frontend/src/components/TopBar.tsx`, `TopBarSearch.tsx`, `AccountMenu.tsx`, `Footer.tsx`, `LanguageSwitch.tsx`, `AppLayout.tsx`, `frontend/src/index.css`, `frontend/src/i18n/uz.ts`, `en.ts`, `frontend/e2e/shots.spec.ts`, `docs/superpowers/specs/2026-10-11-web-ui-design.md`

**Interfaces:**
- Produces: `index.css` `:root`da `--top-bar-h: 56px` (`md`da hozirgi balandlik) va `--bottom-nav-h: calc(64px + env(safe-area-inset-bottom))` (`md`da `0px`); Task 3 `top: var(--top-bar-h)` ni ishlatadi.
- Produces: `bottomNavItems(me: MeResponse | null | undefined, pathname: string): BottomNavItem[]`, `type BottomNavItem = { key: 'home' | 'matches' | 'highlights' | 'clips' | 'profile' | 'signIn'; href: string | null; current: boolean }` (`signIn` da `href: null`, panel uni `SignInDialog` ochuvchi tugma qilib chizadi).
- Consumes: `ownMatchesPath`, `steamPlayerId`, `playerPath` (`lib/matchSource.ts`), `useMe()`.

- [ ] **Step 1: UI shartnomasiga qatorlar** — spec'ning 3-bo'limidan: `TopBar` (`max-md`), `BottomNav`, til joyi, pastki joy. Commit: `docs(spec): the phone's top bar and bottom navigation`.
- [ ] **Step 2: `bottomNavItems`** — qoida (spec 3.2):
  - o'yinchi id = `me.playerId ?? (me.steamId ? steamPlayerId(me.steamId) : null)`;
  - id bor: `matches` → `playerPath(id,'matches')`, `highlights` → `playerPath(id,'highlights')`, `clips` → `/clips`, `profile` → `playerPath(id)`;
  - `me` yo'q (mehmon): `home` → `/`, `clips` → `/clips`, `signIn`;
  - kirgan, id yo'q: `home`, `clips` (Review Focus 4);
  - `current`: `pathname` bandning `href`iga teng yoki `href + '/'` bilan boshlanadi; `/matches/…` da `matches`; `profile` faqat aniq teng bo'lsa (aks holda `/players/id/matches` da ikkisi faol bo'lardi).
- [ ] **Step 3: `BottomNav`** — spec 3.2 qiymatlari (64 px + safe area, `--card`, yuqori chiziq, grid teng ustunlar, faol: `aria-current="page"`, 28×2 `--rec` chiziq, 600; ikonkalar: ro'yxat, chaqmoq, film-play, odam, uy, kirish). `md:hidden`. `/matches/:id/montaj` da va mehmon uchun `/` da `null` qaytaradi. `AppLayout` uni `Footer` dan keyin qo'yadi va asosiy blok + footer'ga `max-md:pb-[var(--bottom-nav-h)]` beradi.
- [ ] **Step 4: Yuqori panel** — `max-md`: bitta 56 px qator (logo; qidiruv tugmasi 44×44 `aria-label` `t.topBar.searchOpen`; avatar yoki "Kirish"); nav havolalari va `LanguageSwitch` `max-md:hidden`. Qidiruv tugmasi `TopBarSearch` ni panel ostida butun kenglikda ochadi (`aria-expanded`), ochilganda fokus maydonga, Esc/qayta bosish/o'yinchi tanlash yopadi va fokus tugmaga qaytadi; ochilish animatsiyasi `motion-reduce:` da yo'q. `md`da hozirgi ko'rinish o'zgarmaydi.
- [ ] **Step 5: Til** — `LanguageSwitch` `AccountMenu` ichida (telefonda) va `Footer`da (`md:hidden`, hamma uchun).
- [ ] **Step 6: `index.css`** — o'zgaruvchilar (Interfaces) va `max-md` `scroll-padding-bottom: calc(var(--bottom-nav-h) + 1rem)` (montaj sahifasining mavjud qoidasi ustidan yozilmaydi).
- [ ] **Step 7: Lug'atlar** — bandlar nomlari (`Matchlar`/`Matches`, `Highlight'lar`/`Highlights`, `Kliplar`/`Clips`, `Profil`/`Profile`, `Bosh sahifa`/`Home`, `Kirish`/`Sign in`), `searchOpen`/`searchClose`, panel `aria-label` (`Asosiy bo'limlar`/`Main sections`).
- [ ] **Step 8: Shots** — yangi holatlar o'z blokida: `nav-visitor` (`/clips`, mehmon), `nav-signed` (`/players/<id>/matches`, kirgan), `nav-noplayer` (kirgan, `playerId` va `steamId` `null`), `search-open` (390, qidiruv ochiq); har biri 390 va 1440, uz/en; `scrolled` varianti — sahifa oxirigacha aylantirilgan 390 rasm (`matches`, `clips`).
- [ ] **Step 9: Tekshiruv**
  Run: `npm --prefix frontend run lint`, `run build`, `test -- --run`, `run e2e`, `run shots -- -g "nav-|search-open|default-.*-390"`
  Expected: lint 0, build ok, Vitest 120 passed, e2e 1 passed; rasmlarda: pastki panel ko'rinadi, faol band to'g'ri, oxirgi qator va footer matni panel ustida; montaj sahifasida panel yo'q. 1440 rasmlari asos bilan bir xil.
  Qo'lda: 390 px'da Tab bilan yurish tartibi va qidiruvning Esc bilan yopilishi (Playwright'da `page.keyboard`, natija hisobotga).
- [ ] **Step 10: Commit** — `feat(frontend): the phone's bottom navigation and one-row top bar`.

### Task 2: Matchlar qatori — ikki qatorli

**Files:**
- Modify: `frontend/src/components/MatchesTable.tsx`, `MatchList.tsx`, `frontend/src/pages/MatchesPage.tsx`, `frontend/src/i18n/uz.ts`, `en.ts`, `frontend/e2e/shots.spec.ts`, `docs/superpowers/specs/2026-10-11-web-ui-design.md`

**Interfaces:**
- Consumes: mavjud `MatchMapCell`, `SourceTag`, `HighlightTag`, `RowAction`, `offersUpload`, `hasRowAction` (o'zgarmagan imzolar).
- Produces: hech narsa (boshqa vazifalar foydalanmaydi).

- [ ] **Step 1: UI shartnomasiga qatorlar** — spec 4-bo'lim. Commit: `docs(spec): the two-line match row on a phone`.
- [ ] **Step 2: `MatchesTable` qatori (`max-md`)** — spec 4 qiymatlari: 1-qator emblema 40 px, xarita 15/600 havola, `SourceTag` + sana mono 11 `--subtle`, o'ngda hisob mono 19/600 natija rangida va natija so'zi 11 px; 2-qator 52 px chekinish bilan K/D/A mono 13/500, `ADR` mono 11 `--subtle`, 3 tagacha `HighlightTag` (kichik) va `+N`, o'ng chekkada klip holati yoki mavjud `RowAction` ("Demo", ≥ 36 px). K/D/A yo'q bo'lsa — raqamlar qismi yo'q, faqat holat. Ustun sarlavhalari `max-md:hidden`. Hozirgi `max-md:row-span-2 … pb-17` joylashuvi shu bilan almashadi. Natija chizig'i va fon (jonli uslub) o'zgarmaydi.
- [ ] **Step 3: Profil tarixi (`MatchList`, `max-md`)** — xuddi shu ikki qatorli ko'rinish (`details`dan K/D/A, ADR, highlight'lar).
- [ ] **Step 4: Filtr tablari (`MatchesPage`, `max-md`)** — bitta qator, `overflow-x: auto`, pill 36 px, faol — to'ldirilgan (`--primary`), sonlar mono; kompyuterda hozirgidek.
- [ ] **Step 5: Shots** — mavjud `default`, `long`, `empty` holatlari 390 da ko'zdan kechiriladi; 360 px'da bitta `long-matches-360-uz` rasm (Review Focus 3).
- [ ] **Step 6: Tekshiruv**
  Run: lint, build, `test -- --run`, `run e2e`, `run shots -- -g "(matches|player)-(390|360|1440)"`
  Expected: hammasi yashil; 390/360 rasmlarida qator ikki qatorda, gorizontal aylantirish yo'q, uzun nik/xarita kesiladi (`…`); 1440 asos bilan bir xil.
- [ ] **Step 7: Commit** — `feat(frontend): two-line match rows on a phone`.

### Task 3: Ro'yxat kartochkalar, ixcham match sarlavhasi, yopishqoq tablar

**Files:**
- Modify: `frontend/src/components/HighlightCard.tsx`, `ClipCard.tsx`, `frontend/src/pages/MatchPage.tsx` (`MatchHeader`, `SectionTabs`), `frontend/src/index.css` (faqat `max-md` scroll-padding-top), `frontend/src/i18n/uz.ts`, `en.ts`, `frontend/e2e/shots.spec.ts`, `docs/superpowers/specs/2026-10-11-web-ui-design.md`

**Interfaces:**
- Consumes: `--top-bar-h` (Task 1; Task 1 hali birlashtirilmagan bo'lsa `index.css`ga `--top-bar-h: 56px` ni `max-md` uchun qo'shadi — birlashtirishda bitta qoladi).
- Consumes: `HighlightCardProps` (`highlight`, `showMatch`, `action`) va `ClipCard({ clip })` — imzolar o'zgarmaydi; `action` telefonda 44×44 joyga tushadi.

- [ ] **Step 1: UI shartnomasiga qatorlar** — spec 5-bo'lim. Commit: `docs(spec): list cards, the compact match header and sticky tabs on a phone`.
- [ ] **Step 2: `HighlightCard` (`max-md`)** — spec 5.1: qator, chapda 112×64 rasm (`CardScenery` manbasi, `object-fit: cover`), ustida `HighlightTag` 9 px va davomiylik; o'rtada raund·tomon mono 10 (tomon rangi), o'yinchi 15/600 bitta qator, tafsilot 12 px bitta qator; o'ngda `action` 44×44 joyda (yozish: oq fon + qizil nuqta, `aria-label`; tayyor: `--positive` ▶; holat: mono 11 foiz/navbat; xato: "Qayta"). `KillTimeline` `max-md:hidden`. Highlight'ni chaqiruvchi joylar (`MatchPage`, `PlayerHighlightsPage`, `PlayerPage`) `action`ni telefon uchun ixcham ko'rinishda berishi kerak bo'lsa — mavjud action komponentlariga `compact` ko'rinish `max-md:` sinflari bilan (yangi prop emas).
- [ ] **Step 3: `ClipCard` (`max-md`)** — spec 5.2: butun qator havola, 112×64 rasm ustida holat (foiz + 3 px `--rec` progress / ▶), sarlavha 14/600 bitta qator, `R9 · 1080p120` mono 10, holat mono 10 holat rangida (TAYYOR — hajmi bilan). Ichidagi amal tugmalari (yuklab olish, bekor qilish, qayta urinish) telefonda klip sahifasiga ko'chmaydi — ular qatorning o'ng chekkasida 44 px ikonkali tugma bo'lib qoladi (havola ichida tugma bo'lmasligi uchun qator tuzilishi: havola — rasm+matn, tugma — yonida).
- [ ] **Step 4: `MatchHeader` (`max-md`)** — spec 5.3: emblema 44, xarita 20/700, `SourceTag` + sana, o'ngda hisob mono 26 natija rangida va natija so'zi, natija rangidagi yuqoridan xira gradient; `RoundStrip` ostida qoladi, gorizontal aylanadi.
- [ ] **Step 5: `SectionTabs` (`max-md`)** — teng uch ustun, 48 px, `sticky top-[var(--top-bar-h)]`, fon `--background`, `z-index` yuqori panel ostida; `index.css`da `max-md` uchun `scroll-padding-top: calc(var(--top-bar-h) + 48px + 8px)` (Review Focus 2).
- [ ] **Step 6: Shots** — mavjud `match`, `highlights`, `clips`, `player` holatlari 390 da; yangi `match-scoreboard` holati: `/matches/<id>#scoreboard` 390 (bo'lim sarlavhasi tablar ostida ko'rinadi); `long` holatida uzun nik.
- [ ] **Step 7: Tekshiruv**
  Run: lint, build, `test -- --run`, `run e2e`, `run shots -- -g "(match|highlights|clips|clip|player|match-scoreboard)-(390|1440)"`
  Expected: hammasi yashil; 390 da highlight va klip qatorlari ~84–88 px, tugmalar 44 px, sarlavha ixcham, `#scoreboard` sarlavhasi yashirinmagan; 1440 asos bilan bir xil.
- [ ] **Step 8: Commit** — `feat(frontend): list cards, a compact match header and sticky tabs on a phone`.

### Yakun (controller)

- [ ] Birlashtirish 1 → 2 → 3, umumiy fayllardagi bloklar to'qnashuvi qo'lda.
- [ ] `main`da: lint, build, Vitest 120, e2e, barcha `shots` (390 va 1440, uz/en); 1440 asos bilan solishtiriladi; 390 rasmlari maketlar (`Main`, `RowsA`, `CardsA`) bilan solishtiriladi va foydalanuvchiga 3–4 ta rasm ko'rsatiladi.
- [ ] Butun branch review, push, foydalanuvchi stack'ida frontend qayta quriladi.
