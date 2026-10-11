import type { Messages } from './index'

// The Uzbek copy, the default language. Game terms (map, match, nickname, ELO, ACE, K/D, ADR ...) stay as they are.
export const uz: Messages = {
  app: {
    homeLink: 'Bosh sahifa',
  },
  home: {
    eyebrow: 'CS2 · FACEIT tahlili',
    title: "O'yinchini toping.",
    subtitle: "FACEIT nickname'ini yozing: ELO, daraja va so'nggi matchlar bir joyda.",
    nicknameLabel: 'nickname',
    placeholder: 'FACEIT nickname',
    submit: 'Qidirish',
    searching: 'Qidirilmoqda…',
    invalidNickname: "Nickname 2–32 belgi bo'lsin: harf, raqam, _ yoki -",
  },
  player: {
    title: "O'yinchi",
    history: 'Matchlar tarixi',
    loading: "O'yinchi yuklanmoqda…",
    loadingMatches: 'Matchlar yuklanmoqda…',
    loadMore: "Yana ko'rsatish",
    elo: (elo) => `${elo} ELO`,
    level: (level) => `${level}-daraja`,
    noCs2Data: "CS2 ma'lumoti yo'q",
  },
  matchList: {
    win: "G'alaba",
    loss: "Mag'lubiyat",
    unknown: "Natija noma'lum",
    empty: "Hali match yo'q",
  },
  match: {
    title: 'Match',
    unknownMap: "Xarita noma'lum",
    statsUnavailable: "Bu match uchun statistika hali yo'q.",
    loading: 'Match yuklanmoqda…',
    loadingStats: 'Statistika yuklanmoqda…',
  },
  stats: {
    team: 'Jamoa',
    winner: "G'olib",
    score: 'Hisob:',
    player: "O'yinchi",
    kills: 'K',
    deaths: 'D',
    assists: 'A',
    headshots: 'HS',
    kdRatio: 'K/D',
    adr: 'ADR',
    empty: "O'yinchilar statistikasi yo'q",
  },
  errors: {
    playerNotFound: "O'yinchi topilmadi",
    matchNotFound: 'Match topilmadi',
    faceitUnavailable: "FACEIT vaqtincha ishlamayapti. Keyinroq urinib ko'ring.",
    generic: "Xatolik yuz berdi. Qayta urinib ko'ring.",
  },
  notFound: {
    title: 'Sahifa topilmadi',
    back: 'Qidiruvga qaytish',
  },
  footer: {
    disclaimer: "Valve, Steam yoki FACEIT bilan bog'liq emas. Counter-Strike — Valve Corporation savdo belgisi.",
  },
  language: {
    label: 'Til',
  },
}
