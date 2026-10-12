// The English copy: what the interface said before it had dictionaries, word for word (the tests assert on it), and
// the texts written since for the screens that came later. The hero of the home page (`home.eyebrow`, `title` and
// `subtitle`) is one of those: it was rewritten for the landing page.
// The shape of this object is the contract of every dictionary: `Messages` (see index.ts) is its type, so a key that
// another language lacks is a compile error. Texts with a number in them are functions.
export const en = {
  app: {
    // Not the old header text: the logo is the link now, and this follows the wordmark in the link's name.
    homeLink: 'Home',
  },
  nav: {
    label: 'Main',
    clips: 'Clips',
  },
  // Signing in (spec 6): the sign-in and the account menu of the top bar, the sign-in dialog, the notice of an account
  // that has no FACEIT player.
  auth: {
    signIn: 'Sign in',
    close: 'Close',
    intro:
      'You do not need a separate account: you sign in with your own Steam or FACEIT account. We never see your password.',
    steamSignIn: 'Sign in with Steam',
    faceitSignIn: 'Sign in with FACEIT',
    comingSoon: 'Coming soon',
    steps: [
      "You confirm the sign-in on Steam's page.",
      'Your FACEIT account is found by your Steam ID.',
      'Your matches and statistics open.',
    ],
    disclaimer: 'Not affiliated with Valve, Steam or FACEIT.',
    sectionsLabel: 'Sections',
    howItWorks: 'How it works',
    clipKinds: 'Clip kinds',
    statistics: 'Statistics',
    matches: 'Matches',
    searchLabel: 'Find a player',
    searchPlaceholder: 'Player name',
    accountMenu: (nickname: string) => `Account menu: ${nickname}`,
    myStatistics: 'My statistics',
    signOut: 'Sign out',
    orByNickname: 'Or without signing in, by nickname',
    signInFailed: 'The sign-in did not work. Try again.',
    unlinkedTag: 'FACEIT not found',
    unlinked: 'No FACEIT account is linked to this Steam account. You can search by nickname.',
  },
  home: {
    eyebrow: 'CS2 demo analysis · highlight clips',
    title: 'Every ace deserves a clip.',
    subtitle:
      'Type a FACEIT nickname to see ELO, matches and statistics in one place. We find the aces, clutches and multi-kills of a demo ourselves.',
    nicknameLabel: 'nickname',
    placeholder: 'FACEIT nickname',
    submit: 'Search',
    searching: 'Searching…',
    invalidNickname: 'Nickname must be 2–32 characters: letters, digits, _ or -',
    // The sections under the search. The clip, the scoreboard and the names in them are made up: `sample` says so.
    sample: 'Sample',
    frameRound: 'MIRAGE · ROUND 14',
    steps: {
      title: 'From demo to clip in three steps',
      demo: {
        title: 'The demo arrives',
        text: 'The demo of a match (.dem) is uploaded. The analysis is ready within minutes.',
        analyzed: 'Analyzed',
      },
      highlights: {
        title: 'Highlights are found',
        text: 'Aces, 4Ks, clutches, no-scopes and more, down to the round and the second.',
      },
      clip: {
        title: 'The clip is recorded',
        text: 'The demo is played back in the game and recorded, and the MP4 stays on the site.',
        // Recording a clip is not open to visitors yet, and the step says so.
        comingSoon: 'Coming soon',
      },
    },
    kinds: {
      title: 'Two kinds of clip',
      highlight: {
        label: 'Highlight clip',
        title: 'One moment, one video',
        text: 'A clip starts 3 seconds before the first kill and ends 2 seconds after the last. Nothing extra.',
      },
      // Its label is `clip.compilation`.
      compilation: {
        title: 'The whole match, only the kills',
        text: 'Every kill of yours in a match, one after another, in one video. The idle time in between is cut.',
      },
      legend: {
        kill: 'Kill',
        included: 'The part that goes into the video',
      },
    },
    statistics: {
      label: 'Statistics',
      title: 'Beyond clips: your game in numbers',
      text: 'Every demo is analyzed round by round. The figures FACEIT does not give are here too.',
      bullets: ['K/D, ADR, HS% and KAST', 'Entry and trade kills', 'Clutch attempts and wins'],
    },
    closing: {
      line: 'See what happened in your last match.',
      button: 'Find a player',
    },
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
    breadcrumb: 'Breadcrumb',
    sections: 'Sections of the match',
    scoreboard: 'Scoreboard',
    minutes: (count: number) => `${count} min`,
    roundCount: (count: number) => (count === 1 ? '1 round' : `${count} rounds`),
    // The sides a team played on, in order, for a screen reader: the page shows them as `CT → T`.
    sides: (first: string, then: string) => `${first} first, then ${then}`,
    // The tag on the visitor's own row of the scoreboard; shown in upper case.
    you: 'You',
    rounds: 'Rounds',
    // What the squares of one round of the strip show, in words: who won it, on which side, and whether it has a
    // highlight.
    roundSummary: (round: number, winner: string | null, side: string | null, highlight: boolean) => {
      const won = winner
        ? side
          ? `${winner} won as ${side}`
          : `${winner} won`
        : side
          ? `${side} won`
          : 'winner unknown'
      return `Round ${round}: ${won}${highlight ? ', has a highlight' : ''}`
    },
    // The key under the round strip; shown in upper case.
    legend: {
      ct: 'CT won',
      t: 'T won',
      highlight: 'Has a highlight',
    },
    // The columns of the scoreboard beyond those of `stats`; game terms, the same in every language.
    columns: {
      headshotShare: 'HS%',
      kast: 'KAST',
      entry: 'Entry',
      trade: 'Trade',
      clutch: 'Clutch',
    },
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
  // The list of a player's matches, and the figures of the player's page that come from the same stored matches: the
  // form strip, the maps and the kinds of highlight.
  matches: {
    title: 'Matches',
    all: 'All',
    // The name of the link "All" beside the history of the profile, for those who hear a page's links without their
    // surroundings.
    allLabel: 'All matches',
    filterLabel: 'Filter matches',
    // Heard after the count of a filter that is followed by "+": more matches are on the next page.
    loadedSoFar: 'loaded so far',
    needsDemo: 'Needs a demo',
    emptyFilter: 'None of the loaded matches fits this filter',
    // The newest matches as squares in the header of the profile; `count` is how many there are (up to ten).
    form: {
      label: (count: number) => (count === 1 ? 'Last match' : `Last ${count} matches`),
      name: (count: number, wins: number, losses: number, unknown: number) =>
        `${count === 1 ? 'Last match' : `Last ${count} matches`}: ${wins} ${wins === 1 ? 'win' : 'wins'}, ` +
        `${losses} ${losses === 1 ? 'loss' : 'losses'}${unknown > 0 ? `, ${unknown} unknown` : ''}`,
    },
    maps: {
      title: 'Maps',
      loading: 'Loading maps…',
      map: 'Map',
      matches: 'Matches',
      winRate: 'Win rate',
      kd: 'K/D',
      adr: 'ADR',
    },
    types: {
      title: 'Highlight types',
      loading: 'Loading highlight types…',
    },
    columns: {
      map: 'Map',
      score: 'Score',
      kda: 'K / D / A',
      highlights: 'Highlights',
      clips: 'Clips',
    },
    highlights: {
      none: 'No highlights',
    },
    // Where the clips would be, for a match whose demo is on its way.
    analyzing: 'Analyzing',
    clips: {
      active: (count: number) => `${count} in progress`,
      ready: (count: number) => `${count} ready`,
      readyAlone: (count: number) => `${count} ${count === 1 ? 'clip' : 'clips'} ready`,
    },
    recorder: {
      title: 'Recording PC',
      loading: 'Loading the recorder status…',
      online: 'Online',
      offline: 'Offline',
      active: 'Recording now',
      queued: 'In the queue',
    },
  },
  statsCards: {
    title: 'Statistics',
    loading: 'Loading statistics…',
    // Game terms again: the same in every language.
    kd: 'K/D',
    hsPercent: 'HS%',
    adr: 'ADR',
    kast: 'KAST',
    entry: 'Entry / match',
    trade: 'Trade / match',
    clutch: 'Clutch %',
    winRate: 'Win Rate',
    needsDemo: 'Needs a demo analysis',
    noClutch: 'No clutch attempt',
    noData: 'No data',
    clutchRecord: (wins: number, attempts: number) => `${wins} of ${attempts} won`,
    basedOn: (matches: number, analyzed: number) =>
      `Based on ${matches} stored ${matches === 1 ? 'match' : 'matches'} (${analyzed} with demo analysis)`,
  },
  highlight: {
    title: 'Highlights',
    playerTitle: 'Player highlights',
    all: 'All highlights',
    loading: 'Loading highlights…',
    empty: 'No highlights yet',
    round: (round: number) => `Round ${round}`,
    duration: 'Duration:',
    // Tags are shown as they are written here.
    knifeKill: 'KNIFE KILL',
    smokeKill: 'SMOKE KILL',
    // A weapon label that is a plain word, not an item name of the game.
    knife: 'Knife',
    headshots: (count: number) => (count === 1 ? '1 headshot' : `${count} headshots`),
    bombDefused: 'Bomb defused with an enemy alive',
    noKills: 'No kills',
    filterLabel: 'Kind of highlight',
    groupAll: 'All',
    groupMine: 'Mine',
    groupMulti: 'Multi-kill',
    groupClutch: 'Clutch',
    groupSpecial: 'Special',
    typeLabel: 'Type',
    anyType: 'All types',
    showMore: (count: number) => (count === 1 ? 'Show 1 more highlight' : `Show ${count} more highlights`),
  },
  demo: {
    title: 'Demo',
    loading: 'Loading demo status…',
    none: 'No demo',
    status: {
      QUEUED: 'Queued',
      STORED: 'Stored',
      PARSED: 'Parsed',
      ANALYZED: 'Analyzed',
      FAILED: 'Failed',
    },
    manage: 'Manage',
    adminKey: 'Admin key',
    fileLabel: 'Demo file (.dem, .dem.gz, .dem.zst)',
    upload: 'Upload',
    importFromFaceit: 'Import from FACEIT',
    analyze: 'Analyze',
    reanalyze: 'Re-analyze',
    wrongKey: 'Wrong admin key',
    sending: 'Sending the request…',
    uploading: 'Uploading the file…',
    accepted: 'Request accepted. The page updates by itself.',
    invalidFile: 'The file must be a demo: .dem, .dem.gz or .dem.zst, and not empty.',
    urlUnavailable: 'FACEIT has no demo file for this match.',
    notParsed: 'The demo has not been parsed yet.',
    tooLarge: 'The file is too large.',
  },
  clip: {
    title: 'Clip',
    listTitle: 'Clips',
    loading: 'Loading clip…',
    loadingList: 'Loading clips…',
    empty: 'No clips yet',
    // The tabs of the signed-in player's clips. They sort the clips that are loaded so far, so an empty tab says that:
    // there may be more of that kind on the next page.
    tabs: {
      label: 'Filter clips by state',
      all: 'All',
      active: 'In progress',
      ready: 'Ready',
      failed: 'Failed',
      emptyActive: 'None of the loaded clips is in progress',
      emptyReady: 'None of the loaded clips is ready',
      emptyFailed: 'None of the loaded clips has failed',
    },
    notFound: 'Clip not found',
    compilation: 'Compilation',
    record: 'Record clip',
    watch: 'Watch',
    retry: 'Try again',
    // The stages of a clip, as a status chip shows them (in upper case, by CSS).
    status: {
      QUEUED: 'Queued',
      RECORDING: 'Recording',
      ENCODING: 'Encoding',
      UPLOADING: 'Uploading',
      DONE: 'Ready',
      FAILED: 'Failed',
    },
    queuePosition: (position: number) => `#${position} in line`,
    order: {
      title: 'Record a clip',
      close: 'Close',
      quality: 'Quality',
      fasterSmaller: 'Faster, smaller file',
      recommended: 'Recommended',
      adminOnly: 'For now only an admin can record clips.',
      queue: 'Queue',
      queueAhead: (count: number) =>
        count === 0 ? 'No clips ahead of yours' : `${count} ${count === 1 ? 'clip' : 'clips'} ahead of yours`,
      recorderOffline: 'The recording PC is offline: the clip will wait in the queue.',
      cancel: 'Cancel',
      start: 'Start recording',
    },
    compilationPanel: {
      text: 'Every kill of one player in this match, in one video.',
      allKills: 'All kills of the match',
      playerLabel: 'Player',
      choosePlayer: 'Choose a player',
      record: 'Record compilation',
    },
    recorder: {
      online: 'Recorder online',
      offline: 'Recorder offline',
      offlineQueued: 'The recording PC is offline, clips wait in the queue',
      queued: (count: number) => `${count} queued`,
      active: (count: number) => `recording ${count}`,
    },
    page: {
      download: 'Download',
      copyLink: 'Copy link',
      copied: 'Link copied',
      copyFailed: 'Could not copy the link',
      videoFailed: 'The video could not be loaded. Reload the page, or try again later.',
      delete: 'Delete',
      confirmDelete: 'Delete this clip and its video?',
      confirmYes: 'Yes, delete',
      keep: 'Keep',
      kills: 'Kills',
      noKills: 'No kills in this clip',
      seek: (time: string) => `Jump to ${time}`,
      about: 'About the clip',
      quality: 'Quality',
      fps: (fps: number) => `${fps} FPS`,
      duration: 'Duration',
      size: 'Size',
      requested: 'Requested',
      recorded: 'Recorded',
      keptUntil: 'Kept until',
      until: (date: string) => date,
      fromMatch: 'From this match',
      match: 'Match',
    },
    errors: {
      highlightGone: 'This highlight no longer exists. Reload the page.',
      demoGone: 'The demo file of this match is no longer stored. Upload it again.',
      steamIdUnknown: "The player's Steam ID is not known.",
      queueFull: 'The queue is full. Try again later.',
      tooLong: 'The clip would be too long.',
      noKills: 'This player has no kills in the demo.',
      inProgress: 'The clip is being recorded and cannot be deleted now.',
    },
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
