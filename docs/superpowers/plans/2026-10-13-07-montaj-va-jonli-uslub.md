# 7-quyi loyiha: Montaj muharriri va jonli uslubning ikkinchi bosqichi — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O'yinchi match ichidagi o'z kill'laridan video yig'adigan sahifa — "Montaj muharriri" — oladi: bo'laklarni tanlaydi, chetlarini kesadi, tartibini o'zgartiradi, slow-mo, sarlavha, intro, musiqa, sifat va 9:16 ni tanlaydi va montajni yozishga yuboradi. Shu bilan birga ilovaning hali oddiy ko'ringan sahifalari (o'yinchi, match, klip, kliplar, highlight'lar) bosh sahifa va "Matchlar" darajasidagi jonli ko'rinishga keltiriladi.

**Architecture:** Montaj — klipning uchinchi turi (`MONTAGE`): bo'laklarni server emas, foydalanuvchi tanlaydi; server ularni demo chegarasi, uzunlik va soni bo'yicha tekshiradi va avvalgi klip navbatiga qo'yadi. Muharrir uchun bitta ochiq o'qish endpointi o'yinchining matchdagi barcha kill'larini raundlar va tick tezligi bilan beradi. Yozuvchi vazifasi (`WorkerJob`) montaj variantlarini oladi; soxta yozuvchi ularni videoda ko'rsatadi (sarlavha, intro kartasi, sekinlashgan bo'lak, 9:16 o'lcham). Muharrirning ko'rinishi videosiz — sxematik: xarita manzarasi, kill feed va o'ynash chizig'i; haqiqiy video yozilgandan keyin klip sahifasida.

**Tech Stack:** Spring Boot 3.5, Flyway `V9`; recorder (TypeScript, ffmpeg); React 19, TanStack Query, Tailwind; yangi kutubxona qo'shilmaydi (sudrash — o'z pointer hodisalari bilan).

**Spec:** `docs/superpowers/specs/2026-10-11-web-ui-design.md` (har yangi komponent va ekran avval shu yerga yoziladi); `2026-10-11-csdemo-uz-alternative-design.md` ("Montaj" qatori: qo'lda tanlangan kill'lar, musiqa, sarlavha, intro; har kill'dan 3 s oldin va 2 s keyin). Foydalanuvchi talabi (2026-10-13): "dizayn bo'yicha yanada chiroyli qilishimiz kerak va video ni edit qiladigan sahifani ham qilishimiz kerak".

## Global Constraints

- Yangi test yozilmaydi; mavjud testlar yashil qoladi va o'chirilmaydi. Frontend tekshiruvi: `npm run lint`, `npx tsc -b`, `npx vitest run`, `npm run build`, `npm run shots` (1440 va 390 px rasmlar).
- `V1`–`V8` tahrirlanmaydi; bu rejaning sxemasi bitta faylda: `V9__montage.sql`.
- Kod, izoh, log va commit xabarlari inglizcha; `docs/superpowers` ostidagi hujjatlar o'zbekcha. Misollarda faqat to'qima qiymatlar (nickname, SteamID).
- Interfeysdagi har matn ikki lug'atda (`uz`, `en`); dizayn tokenlari, mavjud komponentlar, "A · REC" va jonli uslub (xarita emblemasi, manzara, natija ranglari, `--faceit`); rasm ustidagi matn kontrasti matn turgan joyda ta'minlanadi; `prefers-reduced-motion` da hech narsa o'zi harakatlanmaydi.
- Musiqa kutubxonasi faqat nom va id (audio fayl qo'shilmaydi — litsenziya foydalanuvchining qarori); narxlar `[N]` o'rinbosar.
- Foydalanuvchining stekiga (Compose loyihasi `csfaceit`) tegilmaydi.

## Shartnoma (vazifalar orasida o'zgarmaydigan nomlar)

**O'qish — muharrir manbasi** (ochiq, `breakdown` kabi):
`GET /api/v1/matches/{matchId}/editor?playerId=<faceit id yoki steam:<id>>` → `200 EditorSource`

```
EditorSource {
  matchId: string, mapName: string|null, tickRate: number,
  player: { playerId: string, nickname: string },
  rounds: [{ number, startTick, endTick, side: 'CT'|'T'|null,
             kills: [{ tick, weapon, headshot, wallbang, noscope, throughSmoke, victimNickname }] }],
  highlights: [{ id, type, roundNumber, tickStart, tickEnd }],
  limits: { preSeconds: 3, postSeconds: 2, maxSegmentSeconds: 60, maxDurationSeconds: 300, maxSegments: 30,
            qualities: ['720p','1080p'], aspects: ['16:9','9:16'], titleMaxLength: 60,
            musicTracks: [{ id, name }] }
}
```
Faqat o'yinchining kill'i bor raundlar keladi. Xatolar: `404 MATCH_NOT_FOUND`, `404 PLAYER_NOT_IN_MATCH`, `409 DEMO_NOT_AVAILABLE` (demo tahlil qilinmagan).

**Yozish — montaj buyurtmasi** (kompilyatsiya bilan bir xil ruxsat: `requireOwnPlayer`, `CLIP_ORDER` cheklovi, navbat to'la — `429 CLIP_QUEUE_FULL`):
`POST /api/v1/matches/{matchId}/montages` → `202 ClipResponse` (`kind: 'MONTAGE'`)

```
MontageRequest { playerId, quality: '720p'|'1080p', aspect: '16:9'|'9:16', title: string|null, intro: boolean,
                 musicTrack: string|null, segments: [{ startTick, endTick, slowMo: boolean }] }
```
Bo'laklar foydalanuvchi bergan tartibda saqlanadi (saralanmaydi, birlashtirilmaydi). Tekshiruv: 1..`maxSegments` bo'lak; har birida `startTick < endTick`, ikkalasi demo raundlari chegarasida, uzunligi ≤ `maxSegmentSeconds`; umumiy davomiylik (slow-mo bo'lak ikki barobar, intro +2 s) ≤ `maxDurationSeconds`; sarlavha ≤ 60 belgi; noma'lum `musicTrack` yoki `aspect`. Xato kodlari: `400 INVALID_SEGMENTS`, `400 INVALID_MONTAGE_OPTION`, `409 CLIP_TOO_LONG`. Montaj uchun noyoblik indeksi yo'q — har buyurtma yangi klip.

**`ClipResponse`** qo'shimcha maydon oladi: `montage: { title, aspect, intro, musicTrack, segments: [{startTick, endTick, slowMo}] } | null`; `kind` endi `'HIGHLIGHT'|'COMPILATION'|'MONTAGE'`. 9:16 o'lchamlari: 720p → 720×1280, 1080p → 1080×1920.

**`WorkerJob`** qo'shimcha: `segments[].slowMo` (ixtiyoriy, standart `false`), `title`, `intro`, `musicTrack`, `aspect` (montaj bo'lmaganda `null`/`false`).

**Sahifa:** `/matches/:matchId/montaj?player=<playerId>`; qoralama brauzerda (`localStorage`, kalit `csfaceit.montage.<matchId>.<playerId>`).

## Vazifalar

### Task M1: Backend va yozuvchi — montaj turi
- [ ] `V9__montage.sql`: `clips.options JSONB` (montaj variantlari), `kind` uchun `MONTAGE`; `ClipKind.MONTAGE`, `Clip.montage(...)` fabrikasi, `ClipSegment` ga `slowMo`.
- [ ] `ClipFacts` dan foydalanib `GET /matches/{id}/editor` (`EditorController`/`EditorService`); musiqa ro'yxati `clip.music-tracks` sozlamasida (3–4 ta to'qima nom).
- [ ] `POST /matches/{id}/montages`: tekshiruv, ruxsat, cheklov, navbat; `ClipResponse.montage`; 9:16 o'lchamlari; `retry` montajni o'z variantlari bilan qayta qo'yadi.
- [ ] `WorkerJob` va `recorder/src/api.ts` variantlarni oladi; `recorder/src/recorders/fake.ts`: intro kartasi (2 s, sarlavha), slow-mo bo'lak ikki barobar uzun, sarlavha ustki qatorda, 9:16 o'lcham.
- [ ] README: yangi endpointlar, xato kodlari, sozlama.

### Task J1: Jonli uslub — ilova sahifalari (frontend)
- [ ] Spec'ga avval yoziladi: highlight turi ranglari (multi-kill, clutch, maxsus), yangi ko'rinishlar.
- [ ] O'yinchi sahifasi: kattaroq bosh qism, "Matchlar tarixi" qatorlarida xarita emblemasi, nomi va `FACEIT` tegi (`MatchesTable` uslubida), highlight turlari chizig'i turi rangida, rangli `StatTile` urg'ulari.
- [ ] Highlight kartalari (o'yinchi, match, highlight'lar sahifasi): tepasida xarita manzarasi bo'lagi, tur tegi rangida.
- [ ] Match sahifasi: scoreboard'da jamoa tomoni chizig'i (CT/T), g'olib jamoa urg'usi, ko'rilayotgan o'yinchi qatori, K/D rangi; kompilyatsiya paneli manzarali va yonida "Montaj yig'ish" (`/matches/:id/montaj?player=`).
- [ ] Klip sahifasi: kill qatorlari (headshot, wallbang belgilari, qurol), montaj kliplari uchun "MONTAJ" yorlig'i va "Muharrirda ochish"; kliplar va highlight'lar sahifasi sarlavhasi manzarali; `ClipCard` montajni nomlaydi; 404 sahifasi manzarali.

### Task M2: Montaj muharriri sahifasi (frontend, shartnoma bo'yicha)
- [ ] Spec'ga avval: "Montaj muharriri" ekrani va uning komponentlari.
- [ ] `api`: `useEditorSource`, `useOrderMontage`, turlar (`MONTAGE`, `montage`).
- [ ] Sahifa: kill kutubxonasi (raundlar bo'yicha, filtrlar, "hammasini qo'shish"), monitor (sxematik ko'rinish), vaqt chizig'i (bo'laklar, kesish tutqichlari, sudrab tartiblash, kill belgilari, sarlavha/intro va musiqa yo'laklari, o'ynash chizig'i), inspektor (bo'lak va montaj variantlari), pastki panel (davomiylik, cheklovlar, "Montajni yozish" → `ClipOrderDialog` uslubidagi tasdiq). Klaviatura bilan to'liq ishlaydi; telefonda ustma-ust joylashadi.

## Bajarish tartibi

M1, J1 va M2 parallel (har biri o'z worktree'sida). Birlashtirish: J1 → M2 (J1 ustiga rebase, lug'at va spec to'qnashuvlari qo'lda) → M1. So'ng butun shoxga yakuniy review, bitta tuzatish to'lqini, `feature/07-montaj` push qilinadi (`main` ga emas).
