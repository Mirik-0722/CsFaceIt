# Klip yozuvchini Windows'ga o'rnatish — qo'llanma

Bu qo'llanma saytdagi "Klip yozish" tugmasi haqiqiy CS2 videosini chiqarishi uchun Windows kompyuterga yozuvchini
(`recorder`) qanday o'rnatishni qadamma-qadam tushuntiradi. Batafsil inglizcha matn: `recorder/README.md`, "Windows
(real recording)" bo'limi.

## Qanday ishlaydi

```
  Sayt (Mac yoki server)                         Windows kompyuter
  ┌────────────────────────┐   "navbatda nima bor?"   ┌──────────────────────────────┐
  │ klip navbatga tushadi  │ ◄──────────────────────── │ yozuvchi (Node.js)            │
  │                        │ ──── demo + kill'lar ───► │ CS Demo Manager → CS2 + HLAE  │
  │ video saytda chiqadi   │ ◄──────── MP4 ─────────── │ o'yin ochiladi, yozadi, yopadi│
  └────────────────────────┘                           └──────────────────────────────┘
```

Yozuvchi saytga o'zi ulanadi va navbatdagi klipni oladi. Sayt Windows'ga hech narsa yubormaydi, shuning uchun
Windows'da port ochish shart emas.

## Kerak bo'ladi

| Nima | Izoh |
|---|---|
| Windows 10 yoki 11, 64-bit | |
| Video karta | 720p uchun kamida GTX 1060 / RX 580; 1080p 60 fps uchun kuchliroq |
| 16 GB xotira, SSD'da 60 GB bo'sh joy | CS2 ≈ 35 GB, har demo ≈ 400 MB |
| Simli internet (tavsiya) | demo 100+ MB, video o'nlab MB |
| **Alohida Steam hisobi** | o'zingiz o'ynaydigan hisob emas: yozuvchi har klipda CS2'ni yopib-ochadi. CS2 bepul |

Yozish paytida bu kompyuterda boshqa ish qilinmaydi va o'yin o'ynalmaydi.

---

## 1-qism. Mac'da (bir marta)

1. **Mac'ning tarmoqdagi manzilini toping:** System Settings → Wi-Fi → Details → "IP address", yoki Terminal'da:
   ```bash
   ipconfig getifaddr en0
   ```
   2026-10-15 kuni bu `192.168.0.102` edi. Router qayta yoqilganda o'zgarishi mumkin: routerda shu manzilni Mac'ga
   doimiy qilib qo'yish yaxshi (DHCP reservation).
2. **Yozuvchi tokeni.** Loyiha papkasidagi `.env` faylida `CLIP_WORKER_TOKEN=` qatori bo'sh bo'lmasligi kerak. Bo'sh
   bo'lsa, Terminal'da `openssl rand -hex 32` bilan qiymat oling, shu qatorga yozing va backend'ni qayta yarating:
   ```bash
   docker compose up -d backend
   ```
   Shu qiymatni nusxalab qo'ying: Windows'da 11-qadamda kerak bo'ladi. Uni hech kimga yubormang.
3. **Mac uxlamasin**, chunki sayt Mac'da ishlaydi. macOS firewall yoqiq bo'lsa: System Settings → Network → Firewall
   → Options → Docker'ga kiruvchi ulanishlarga ruxsat bering.
4. Soxta yozuvchi (`recorder-fake`, rangli chiziqli sinov videosi) ishlamasligi kerak, aks holda u kliplarni haqiqiy
   yozuvchidan oldin olib qo'yadi. U to'xtatilgan; yana ishga tushirmang.

---

## 2-qism. Windows'da o'rnatish (shu tartibda)

5. **Steam.** O'rnating, yozish uchun ochilgan alohida hisobga **"Remember me"** belgisi bilan kiring. Steam
   sozlamalarida "Windows bilan birga ishga tushsin" ni yoqing.
6. **CS2.** O'rnating va **bir marta qo'lda oching**: birinchi ochilishini to'liq kuting (shader'lar tayyorlanadi),
   grafikani kliplar qanday ko'rinishini xohlasangiz shunday qo'ying, keyin o'yindan chiqing.
7. **PostgreSQL** (CS Demo Manager shuni talab qiladi): https://www.postgresql.org/download/windows/ — port **5432**.
   `postgres` foydalanuvchisiga bergan parolni yozib qo'ying.
8. **CS Demo Manager:** https://cs-demo-manager.com — o'rnating. Birinchi ochilganda bazani ko'rsating: `127.0.0.1`,
   `5432`, `postgres` va 7-qadamdagi parol. Settings → About bo'limida **avtomatik yangilanishni o'chiring** (yozish
   o'rtasida yangilansa, klip buziladi).
9. **Node.js 22 LTS:** https://nodejs.org — hamma narsani standart qoldiring.
10. **Loyiha.** Git for Windows o'rnating va PowerShell'da:
    ```powershell
    mkdir C:\csfaceit
    cd C:\csfaceit
    git clone https://github.com/Mirik-0722/CsFaceIt.git
    ```
    Yo'lda bo'sh joy va inglizcha bo'lmagan harf bo'lmasin: aynan `C:\csfaceit\CsFaceIt` bo'lgani ma'qul.

---

## 3-qism. Birinchi sinov (qo'lda, bir marta)

Bu sinov CS Demo Manager shu kompyuterda CS2'ni boshqara olishini tekshiradi. HLAE va FFmpeg shu birinchi videoda
o'zi o'rnatiladi.

11-qadamdan oldin:

- **Yangi** FACEIT demosini oling (oxirgi kunlardagi matchdan; eski demo yangi CS2'da ochilmasligi mumkin) va uni
  `C:\csfaceit\trial\demo.dem` qilib qo'ying.
- PowerShell'da:
  ```powershell
  mkdir C:\csfaceit\trial
  csdm analyze C:\csfaceit\trial\demo.dem
  csdm analyze C:\csfaceit\trial\demo.dem
  copy C:\csfaceit\CsFaceIt\recorder\csdm-config.template.jsonc C:\csfaceit\trial\trial.jsonc
  notepad C:\csfaceit\trial\trial.jsonc
  ```
  Ikkinchi `analyze` "already in database" deyishi kerak.
- `trial.jsonc` ichida: `startTick` — biror kill'dan taxminan 3 soniya oldin (64 tick = 1 soniya, ya'ni 192 tick
  oldin), `endTick` — kill'dan 2 soniya keyin, kamera `tick` i = `startTick`, `playerSteamId` — o'ldirgan o'yinchining
  SteamID64'i. Kill tick'larini CS Demo Manager'da match → Video sahifasidan olsa bo'ladi.
- Keyin:
  ```powershell
  csdm video --config-file C:\csfaceit\trial\trial.jsonc
  ```
  O'yin o'zi ochilib, yozib, yopiladi. `C:\csfaceit\trial` ichida `sequence-1-...mp4` paydo bo'ladi: unda kill
  o'yinchining ko'zidan taxminan 3-soniyada ko'rinishi kerak.

Ishlamasa, chiqqan xato matnini menga yuboring. Ishlasa: CS2, CS Demo Manager va HLAE versiyalarini, qancha vaqt
ketganini va ekran qulflanganda ham yozdimi, yozib qo'ying.

---

## 4-qism. Yozuvchini sozlash va ishga tushirish

11. **Sozlamalar fayli.** Nusxalang:
    ```powershell
    copy C:\csfaceit\CsFaceIt\recorder\windows\recorder.env.example C:\csfaceit\recorder.env
    notepad C:\csfaceit\recorder.env
    ```
    Ichida o'zgartiring:
    ```
    BACKEND_URL=http://192.168.0.102:3000
    CLIP_WORKER_TOKEN=<Mac'dagi .env dan, 2-qadam>
    RECORDER_MODE=csdm
    WORKER_NAME=windows-1
    WORK_DIR=C:\csfaceit\work
    ```
    Qo'shtirnoq qo'ymang, `=` atrofida bo'sh joy bo'lmasin.
12. **Ulanishni tekshiring** (PowerShell):
    ```powershell
    curl.exe http://192.168.0.102:3000/api/v1/recorder/status
    ```
    JSON chiqishi kerak, masalan `{"online":false,...}`. Chiqmasa: Mac yoqiqmi, manzil to'g'rimi, Mac firewall'i
    (3-qadam).
13. **O'rnatish va ishga tushirish:**
    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\csfaceit\CsFaceIt\recorder\windows\install.ps1 -EnvFile C:\csfaceit\recorder.env -StartNow
    ```
    Bu yozuvchini quradi va Windows'ga har kirganingizda o'zi ishga tushadigan qiladi (Task Scheduler).

---

## 5-qism. Ishlayotganini qanday bilasiz

14. **Log:** `C:\csfaceit\CsFaceIt\recorder\logs\recorder-<sana>.log`. Jonli ko'rish:
    ```powershell
    Get-Content -Wait C:\csfaceit\CsFaceIt\recorder\logs\recorder-<sana>.log
    ```
    Boshida `Recorder ... starts as 'windows-1' in mode csdm` bo'ladi. `refused the worker token` (token noto'g'ri)
    yoki `No clip taken` qatorlari bo'lmasligi kerak.
15. **Saytda:** "Kliplar" sahifasida yozuvchi **"Onlayn"** deb ko'rinadi.
16. **Sinov klipi:** demosi tahlil qilingan matchda bitta highlight uchun klip buyurtma qiling. Windows'da o'yin o'zi
    ochiladi, yozadi va yopiladi; saytda klip "Tayyor" bo'ladi va video o'yinchining ko'zidan ko'rinadi.

---

## Doimiy ishlashi uchun

- **Uxlamasin:** Settings → System → Power → ekran va uyqu "Never" (yoki PowerShell'da
  `powercfg /change standby-timeout-ac 0`).
- **Avtomatik kirish:** kompyuter qayta yoqilganda yozuvchi o'zi ishlashi uchun Microsoft'ning Sysinternals
  **Autologon** dasturi bilan yozish foydalanuvchisiga avtomatik kirishni yoqing. Sinov ekran qulflanganda ham
  yozishini ko'rsatmaguncha, ekran qulflanmasin.
- **Yangilanishlar yozish paytida bo'lmasin:** Windows Update'ga faol soatlarni qo'ying yoki pauza qiling; Steam
  o'yinlarni faqat kechasi yangilasin (Settings → Downloads); CS Demo Manager'ning avtomatik yangilanishi o'chiq.
- Steam doim yoqiq va hisobga kirilgan bo'lsin.

## CS2 yangilansa

1. Steam CS2'ni yangilasin, keyin CS2'ni bir marta qo'lda oching va yoping.
2. CS Demo Manager'ni yangilang (sayt) va HLAE'ni (CS Demo Manager'da match → Video sahifasi yangilashni taklif
   qiladi).
3. Bitta sinov video qiling (3-qism).
4. Yozuvchini qayta ishga tushiring: `Start-ScheduledTask -TaskName 'CsFaceIt recorder'`.

Bu orada ishlamay qolgan kliplar saytda sababi bilan ko'rinadi; "Qayta urinish" tugmasi ularni qaytadan navbatga
qo'yadi.

## Sayt serverga ko'chganda

`C:\csfaceit\recorder.env` da faqat ikki qatorni o'zgartirasiz:
```
BACKEND_URL=https://sizning-domeningiz
CLIP_WORKER_TOKEN=<server .env idagi CLIP_WORKER_TOKEN>
```
keyin `Start-ScheduledTask -TaskName 'CsFaceIt recorder'` (yoki kompyuterni qayta yoqing). Windows kompyuter uyda
qolaveradi: u serverga internet orqali ulanadi.

## Muammo bo'lsa

Klip sahifasidagi xato matnini `recorder/README.md` dagi "When something goes wrong on Windows" jadvalidan qidiring
yoki matnni (yoki skrinshotni) menga yuboring. Eslatma: yozuvchi CS Demo Manager'ning manba kodiga qarab yozilgan va
birinchi marta sizning kompyuteringizda ishlaydi — birinchi ishga tushirishda kichik tuzatishlar kerak bo'lishi
mumkin.
