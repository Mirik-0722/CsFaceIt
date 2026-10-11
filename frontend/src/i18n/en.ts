// The English copy: what the interface said before it had dictionaries, word for word (the tests assert on it).
// The shape of this object is the contract of every dictionary: `Messages` (see index.ts) is its type, so a key that
// another language lacks is a compile error. Texts with a number in them are functions.
export const en = {
  app: {
    homeLink: 'CS2 FACEIT Analyzer',
  },
  home: {
    eyebrow: 'CS2 · FACEIT analytics',
    title: 'Player search',
    subtitle: 'Type a FACEIT nickname to see ELO, level and recent matches.',
    nicknameLabel: 'nickname',
    placeholder: 'FACEIT nickname',
    submit: 'Search',
    searching: 'Searching…',
    invalidNickname: 'Nickname must be 2–32 characters: letters, digits, _ or -',
  },
  player: {
    title: 'Player profile',
    history: 'Match history',
    loading: 'Loading player…',
    loadingMatches: 'Loading matches…',
    loadMore: 'Load more',
    elo: (elo: number) => `ELO ${elo}`,
    level: (level: number) => `Level ${level}`,
    noCs2Data: 'No CS2 data',
  },
  matchList: {
    win: 'WIN',
    loss: 'LOSS',
    unknown: 'Result unknown',
    empty: 'No matches yet',
  },
  match: {
    title: 'Match',
    unknownMap: 'Unknown map',
    statsUnavailable: 'Stats are not available for this match yet.',
    loading: 'Loading match…',
    loadingStats: 'Loading stats…',
  },
  stats: {
    team: 'Team',
    winner: 'Winner',
    score: 'Score:',
    player: 'Player',
    // Game terms are not translated: the column abbreviations read the same in every language.
    kills: 'K',
    deaths: 'D',
    assists: 'A',
    headshots: 'HS',
    kdRatio: 'K/D',
    adr: 'ADR',
    empty: 'No player stats',
  },
  errors: {
    playerNotFound: 'Player not found',
    matchNotFound: 'Match not found',
    faceitUnavailable: 'FACEIT is temporarily unavailable. Try again later.',
    generic: 'Something went wrong. Try again.',
  },
  notFound: {
    title: 'Page not found',
    back: 'Back to search',
  },
  footer: {
    disclaimer: 'Not affiliated with Valve, Steam or FACEIT. Counter-Strike is a trademark of Valve Corporation.',
  },
  language: {
    label: 'Language',
  },
}
