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
    byNickname: 'By nickname',
    signInFailed: 'The sign-in did not work. Try again.',
    unlinkedTag: 'FACEIT not found',
    unlinked: 'No FACEIT account is linked to this Steam account. You can search by nickname.',
    // A write that the backend refused as nobody's (401) although the page thought somebody was signed in: the visitor
    // signed out in another tab, or the session ran out.
    sessionEnded: 'Your session has ended. Sign in again.',
  },
  // Why a signed-in visitor may not do something, with the way out where there is one. The upper-case keys are the
  // backend's 403 codes: the page says the same words when it foresees the refusal and when the backend gives it.
  access: {
    FACEIT_NOT_LINKED:
      'No FACEIT account is linked to this Steam account, so the site cannot tell which matches are yours. Link Steam in your FACEIT profile, then sign in again.',
    NOT_IN_MATCH: 'You did not play in this match. Its demo is managed by the players of the match.',
    NOT_YOUR_PLAYER: 'You can record clips of your own highlights only.',
    NOT_YOUR_CLIP: 'This clip was ordered by someone else.',
    CROSS_SITE_REQUEST: 'The request did not come from this site. Reload the page and try again.',
    // A 403 with a code the page does not know, or with no code at all.
    notAllowed: 'You are not allowed to do this.',
    // The quiet switch that opens the admin key field for an operator who is signed in.
    useAdminKey: 'Use the admin key',
  },
  // A used-up limit (429). `nextAt` words the moment the next request is possible: the hour when it is today, the day
  // and the hour otherwise; each sentence takes it, or null when the backend named no moment.
  limits: {
    nextAt: (time: string, day: string | null) => (day ? `on ${day} at ${time}` : `at ${time}`),
    UPLOAD_LIMIT_REACHED: (next: string | null) =>
      `You have reached today's limit of demo uploads. ${next ? `The next one is possible ${next}.` : 'Try again later.'}`,
    IMPORT_LIMIT_REACHED: (next: string | null) =>
      `You have reached today's limit of demo imports. ${next ? `The next one is possible ${next}.` : 'Try again later.'}`,
    CLIP_LIMIT_REACHED: (next: string | null) =>
      `You have reached today's limit of clip orders. ${next ? `The next one is possible ${next}.` : 'Try again later.'}`,
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
    // The corner label of the sample frame: the map is the one whose turn it is in the strip of maps (or the sample
    // video's map, when there is a video), and the round is the sample clip's.
    frameRound: (map: string, round: number) => `${map} · ROUND ${round}`,
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
    // The strip of maps at the foot of the hero: its label, and the two names of the button that stops the maps from
    // taking turns and lets them go on.
    maps: {
      label: 'On every map',
      stop: 'Stop turning through the maps',
      resume: 'Resume turning through the maps',
    },
  },
  player: {
    title: 'Player profile',
    history: 'Match history',
    loading: 'Loading player…',
    loadingMatches: 'Loading matches…',
    loadMore: 'Load more',
    elo: (elo: number | string) => `ELO ${elo}`,
    level: (level: number) => `Level ${level}`,
    faceitLevel: (level: number) => `FACEIT Level ${level}`,
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
    // Under the rows when the list has not been refreshed for a while although it is being asked again.
    notUpdating: 'The list is not updating. Trying again.',
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
    // The box beside the list of the signed-in player's own matches, where a demo is brought in: a file, a pasted link,
    // or a file dropped anywhere on the page; the feed above the rows says how each one goes.
    bring: {
      title: 'Upload a demo',
      text: 'Drop a .dem, .dem.zst or .dem.bz2 file here. A FACEIT demo is downloaded from the match room.',
      choose: 'Choose a file',
      linkLabel: 'Demo link',
      linkPlaceholder: 'Or paste a link',
      linkSubmit: 'Fetch',
      drop: 'Drop the demo file to upload it',
      // The action of a row whose match has no demo; `label` is the match, for the name a screen reader hears.
      row: 'Upload a demo',
      rowFor: (label: string) => `Upload a demo for ${label}`,
      feedLabel: 'Demo uploads',
      sending: (percent: number) => `Uploading ${percent}%`,
      fetching: 'Fetching…',
      sent: 'Sent. The row follows the demo by itself.',
      dismiss: 'Close',
      // A file whose name has no match id (it was renamed): why it is not uploaded, and where the way out is.
      noMatchId: (name: string) =>
        `The name of "${name}" has no match id, so the site cannot tell which match it is. Upload it with "Upload a demo" on that match's row in the list.`,
      noLinkId:
        'The file in this link has no match id in its name, so the site cannot tell which match it is. Upload the file with "Upload a demo" on that match\'s row in the list.',
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
    // The line under a figure: how many matches it is made of.
    overMatches: (matches: number) => `over ${matches} ${matches === 1 ? 'match' : 'matches'}`,
    averageOfMatches: (matches: number) => `average of ${matches} ${matches === 1 ? 'match' : 'matches'}`,
    clutchRecord: (wins: number, attempts: number) =>
      `${wins} of ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`,
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
    // The same kind in the list of a player's highlights by kind, which is written in sentence case.
    smokeName: 'Through smoke',
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
    fileLabel: 'Demo file (.dem, .dem.gz, .dem.zst, .dem.bz2)',
    upload: 'Upload',
    importFromFaceit: 'Import from FACEIT',
    analyze: 'Analyze',
    reanalyze: 'Re-analyze',
    wrongKey: 'Wrong admin key',
    sending: 'Sending the request…',
    uploading: 'Uploading the file…',
    accepted: 'Request accepted. The page updates by itself.',
    invalidFile: 'The file must be a demo: .dem, .dem.gz, .dem.zst or .dem.bz2, and not empty.',
    urlUnavailable: 'FACEIT has no demo file for this match.',
    // A demo that failed with the code DOWNLOAD_NEEDS_ACCESS: the site is not given the file, so the visitor fetches it.
    needsAccess:
      "FACEIT did not let this site download the demo. Download it from the match's room on FACEIT and upload the file below with the admin key.",
    // The same for a visitor who may upload without the key: a player of the match, or an administrator.
    needsAccessMember:
      "FACEIT did not let this site download the demo. Download it from the match's room on FACEIT and upload the file below.",
    // The same for a signed-in visitor who cannot upload: what happened, without sending the visitor anywhere.
    needsAccessPlain: 'FACEIT did not let this site download the demo.',
    needsAccessLink: "The match's room on FACEIT",
    // Heard by a screen reader after the link's text, because the link opens another tab.
    newTab: '(opens in a new tab)',
    notParsed: 'The demo has not been parsed yet.',
    tooLarge: 'The file is too large.',
    // 409 DEMO_ALREADY_PARSED and DEMO_ALREADY_ANALYZED; the first is also what the panel says in place of the upload
    // to a player of a match whose demo is read.
    alreadyParsed: 'A demo of this match has already been read. Only an administrator can replace it.',
    alreadyAnalyzed: 'The demo is already analyzed.',
    // An upload by the session that ended without an answer: the backend refuses an upload before it reads the file
    // and may close the connection, which the browser reports as a failed request.
    uploadInterrupted: 'The upload was interrupted. It may have been refused: try again, or sign in again.',
    // The 400 codes of a pasted link: the text is not a usable link, it points to a host the site does not fetch from,
    // or its file is the demo of another match.
    linkInvalid: 'This is not a link to a demo file. Paste the link as FACEIT gives it.',
    linkHostNotAllowed: 'The site does not fetch demos from this address. Use the link from the match room on FACEIT.',
    linkMismatch: 'The file in this link is the demo of another match.',
    // IMPORT_FAILED for a signed-in visitor who cannot upload (see `reasons` for everybody else).
    importFailedPlain: 'The demo could not be fetched from FACEIT.',
    // The line of four steps under the status: its name for a screen reader, the steps (shown in upper case), and the
    // state of a step in words, heard after its name.
    stages: {
      label: 'Stages of the demo',
      steps: {
        download: 'Fetch',
        read: 'Read',
        analysis: 'Analysis',
        ready: 'Ready',
      },
      state: {
        done: 'done',
        current: 'in progress',
        failed: 'failed',
        waiting: 'not started',
      },
    },
    // The codes of `DemoResponse.errorCode` the page words itself (DOWNLOAD_NEEDS_ACCESS has `needsAccess` above, with its
    // link). IMPORT_FAILED sends the visitor to the upload, as the panel's controls do.
    reasons: {
      IMPORT_FAILED: 'The demo could not be fetched from FACEIT. You can upload it as a file.',
      PARSE_FAILED: 'The demo file could not be read. The file may be damaged.',
      ANALYSIS_FAILED: 'The demo analysis did not finish. Try again.',
      WRONG_MATCH: 'This file is the demo of another match: its players are not the players of this one.',
    },
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
    // The actions on the card of one's own clip. The name of each says which clip, since a page has many.
    card: {
      cancel: 'Cancel',
      cancelFor: (label: string) => `Cancel the order of ${label}`,
      confirmCancel: 'Cancel the order?',
      confirmYes: 'Yes',
      keep: 'No',
      retryFor: (label: string) => `Try again: ${label}`,
      downloadFor: (label: string) => `Download ${label}`,
    },
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
      // Under the key field of a visitor who is not signed in.
      needsKey: 'Sign in to record clips of your own highlights. Without signing in, a clip needs the admin key.',
      // The day's limit of a signed-in visitor: the name of the row, what is left, and the line at zero (`next` is
      // `limits.nextAt`, or null).
      orders: 'Orders',
      ordersLeft: (remaining: number, limit: number) => `${remaining} of ${limit} left today`,
      noneLeft: (next: string | null) =>
        `No orders left today. ${next ? `The next one is possible ${next}.` : 'Try again later.'}`,
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
      queued: (count: number) => `${count}\u00a0queued`,
      active: (count: number) => `recording\u00a0${count}`,
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
      // The same for a clip that still waits in the queue: deleting it is taking the order back.
      cancel: 'Cancel order',
      confirmCancel: 'Cancel this order?',
      confirmCancelYes: 'Yes, cancel',
      kills: 'Kills',
      noKills: 'No kills in this clip',
      seek: (time: string) => `Jump to ${time}`,
      about: 'About the clip',
      map: 'Map',
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
      play: 'Play the clip',
      // The mono facts about the player under the title: `FACEIT 8 · ELO 1,742`; either part is left out without data.
      faceitFacts: (level: number | null, elo: string | null) =>
        [level !== null && `FACEIT ${level}`, elo !== null && `ELO ${elo}`].filter(Boolean).join(' · '),
    },
    errors: {
      highlightGone: 'This highlight no longer exists. Reload the page.',
      demoGone: 'The demo file of this match is no longer stored. Upload it again.',
      steamIdUnknown: "The player's Steam ID is not known.",
      queueFull: 'The queue is full. Try again later.',
      tooLong: 'The clip would be too long.',
      noKills: 'This player has no kills in the demo.',
      inProgress: 'The clip is being recorded and cannot be deleted now.',
      notFailed: 'Only a failed clip can be tried again.',
    },
    // Why a clip failed, by the code of `ClipResponse.errorCode`; a reason the recorder reports has no code and is shown
    // as the recorder wrote it.
    reasons: {
      RECORDER_STOPPED: 'The recorder did not respond',
      NO_REASON: 'The recorder did not say why',
      DEMO_GONE: 'The demo file is no longer stored',
      STEAM_ID_UNKNOWN: "The player's Steam ID is not known",
    },
  },
  // The montage editor (plan 7): a video put together from the player's own kills of one match. The mono labels are
  // shown in upper case by CSS.
  montage: {
    title: 'Montage editor',
    // What a montage clip is called beside the other kinds (`clip.compilation`).
    kind: 'Montage',
    loading: 'Loading the kills…',
    // `MIRAGE · 8 ROUNDS · 23 KILLS`: the rounds in which the player killed, and the kills.
    facts: (rounds: number, kills: number) =>
      `${rounds} ${rounds === 1 ? 'round' : 'rounds'} · ${kills} ${kills === 1 ? 'kill' : 'kills'}`,
    seconds: (seconds: string) => `${seconds} s`,
    draft: {
      saved: 'Draft saved',
      saving: 'Saving…',
      notSaved: 'The draft is not saved: the browser does not keep it',
    },
    clear: 'Clear',
    confirmClear: 'Clear the montage?',
    clearYes: 'Yes',
    clearNo: 'No',
    record: 'Record the montage',
    // Where the order button is, for a visitor who is not signed in.
    signInToRecord: 'Sign in to record a montage of your own kills.',
    signIn: 'Sign in',
    // The bar that stays at the bottom of a phone's screen.
    orderBar: 'Order',
    library: {
      title: 'Kills',
      filterLabel: 'Filter the kills',
      filters: {
        all: 'All',
        headshots: 'Headshots',
        awp: 'AWP',
        highlights: 'Highlight rounds',
      },
      addAll: 'Add all',
      round: (round: number) => `Round ${round}`,
      addRound: 'Round',
      addRoundLabel: (round: number) => `Add round ${round}`,
      addKill: (weapon: string, victim: string, round: number, time: string) =>
        `Add ${weapon} on ${victim}, round ${round}, ${time}`,
      inMontage: (weapon: string, victim: string, round: number, time: string) =>
        `In the montage: ${weapon} on ${victim}, round ${round}, ${time}. Select its segment`,
      empty: 'No kill fits this filter.',
    },
    // How a kill was made, as tags of the library (game terms, except the smoke).
    marks: {
      headshot: 'HS',
      wallbang: 'Wallbang',
      noscope: 'No-scope',
      smoke: 'Smoke',
    },
    monitor: {
      label: 'Preview',
      schematic: 'Schematic view · the video is ready once it is recorded',
      segment: (number: number, count: number) => `Segment ${number}/${count}`,
      intro: 'Intro',
      empty: 'The montage is empty. Add kills from the library, or start with all of them.',
      startWithAll: 'Start with all kills',
      play: 'Play',
      pause: 'Pause',
      previous: 'Previous segment',
      next: 'Next segment',
      time: 'Time',
      slowMo: 'Slow motion',
    },
    timeline: {
      title: 'Timeline',
      hint: 'Drag a segment to reorder it, drag its edges to trim it.',
      video: 'Video',
      titleTrack: 'Title',
      music: 'Music',
      playhead: 'Playhead',
      segments: 'Segments of the montage',
      segmentName: (number: number, round: number, from: string, to: string, kills: number, slowMo: boolean) =>
        `Segment ${number}: round ${round}, ${from} to ${to}, ${kills} ${kills === 1 ? 'kill' : 'kills'}` +
        (slowMo ? ', slow motion' : ''),
      empty: 'Add kills from the library: each one becomes a segment here.',
      intro: 'Intro',
      noTitle: 'No title',
      noMusic: 'No music',
    },
    inspector: {
      title: 'Inspector',
      segment: (number: number, count: number) => `Segment ${number}/${count}`,
      noSegment: 'Select a segment on the timeline to trim it, slow it down or move it.',
      start: 'Start',
      end: 'End',
      length: 'Length',
      // The steppers: what the button does, said with the edge it moves.
      earlier: (edge: string) => `${edge}: 0.5 s earlier`,
      later: (edge: string) => `${edge}: 0.5 s later`,
      slowMo: 'Slow motion (half speed)',
      kills: 'Kills in the segment',
      noKills: 'No kill in this segment',
      moveLeft: 'Move left',
      moveRight: 'Move right',
      remove: 'Remove',
      montage: 'Montage',
      titleLabel: 'Title',
      titlePlaceholder: 'Shown at the top of the video',
      intro: 'Intro card (2 s, with the title)',
      music: 'Music',
      noMusic: 'No music',
      quality: 'Quality',
      aspect: 'Aspect',
      aspects: {
        '16:9': 'Landscape',
        '9:16': 'Vertical',
      },
      summary: 'Summary',
      duration: 'Duration',
      segments: 'Segments',
      price: 'Price',
      priceValue: '[N] coin',
    },
    problems: {
      empty: 'Add at least one segment.',
      tooManySegments: (count: number, max: number) => `Too many segments: ${count}, at most ${max}.`,
      tooLong: (total: string, max: string) => `The montage is too long: ${total}, at most ${max}.`,
      segmentTooLong: (number: number, max: number) => `Segment ${number} is longer than ${max} s.`,
      titleTooLong: (max: number) => `The title is longer than ${max} characters.`,
    },
    order: {
      title: 'Record the montage',
      segments: (count: number) => `${count} ${count === 1 ? 'segment' : 'segments'}`,
      intro: 'intro',
    },
    // Why the editor cannot open, and the codes of a refused order.
    errors: {
      noPlayer: 'No player is chosen. Open the editor from the match page.',
      demoNotAnalyzed: 'The demo of this match has not been analyzed yet. Bring the demo in on the match page first.',
      playerNotInMatch: 'This player did not play in this match.',
      noKills: 'This player has no kill in the demo of this match.',
      backToMatch: 'Back to the match',
      invalidSegments: 'The segments no longer fit the demo. Reload the page and check them.',
      invalidOption: 'One of the chosen options is no longer offered. Choose the music, the quality and the aspect again.',
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
  // The third step of the lively style (plan 7, J1): the player's header, the rows of the profile's history, the
  // montage clips and the way to the montage editor.
  lively: {
    // Before the map the player has played most, in the header; shown in upper case.
    mainMap: 'Main map',
    // What a row of the profile's history says of the player's figures, for those who hear it.
    kda: (kills: number, deaths: number, assists: number) =>
      `${kills} ${kills === 1 ? 'kill' : 'kills'}, ${deaths} ${deaths === 1 ? 'death' : 'deaths'}, ${assists} ${assists === 1 ? 'assist' : 'assists'}`,
    // The name of a montage clip without a title of its own, and its tag (shown in upper case).
    montage: 'Montage',
    // The way from the compilation panel to the montage editor, and from a montage clip back to it.
    buildMontage: 'Build a montage',
    openInEditor: 'Open in the editor',
    // The mark of a montage that starts with a title card; shown in upper case.
    intro: 'Intro',
  },
  // CS2 matchmaking (plan 6c): the tag of a matchmaking match, and the section of the matches page that links the
  // visitor's matchmaking games so that their demos come by themselves.
  cs2: {
    // The tag of a matchmaking match, the same in every language (shown in upper case); `tagName` is what a screen
    // reader hears for it.
    tag: 'CS2 MM',
    tagName: 'CS2 matchmaking',
    // The section's label, shown in upper case.
    title: 'CS2 matchmaking',
    intro: 'Have the demos of your Premier, Competitive and Wingman matches come by themselves: enter two codes once.',
    // Steam's own names of the two codes, as its pages write them.
    authLabel: 'Authentication code',
    shareLabel: 'Match sharing code',
    authPlaceholder: 'AAAA-AAAAA-AAAA',
    sharePlaceholder: 'CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx',
    showCode: 'Show the code',
    hideCode: 'Hide the code',
    codesLink: 'Get both codes on Steam',
    link: 'Link',
    // The same request for a link whose code stopped working.
    relink: 'Update',
    linking: 'Linking…',
    // Why a code was not sent: its form is wrong.
    authFormat: 'The code has the form AAAA-AAAAA-AAAA.',
    shareFormat: 'The code starts with CSGO- and has five groups of five characters.',
    // The two 422 refusals of the link.
    authRefused: 'Steam did not accept this authentication code. Check it, or get a new one on Steam.',
    shareRefused:
      'Steam did not recognise this match sharing code with this authentication code. Enter the code of your last match.',
    active: 'Linked — new matches come by themselves',
    // A link in a state this page does not know.
    linked: 'Linked',
    checkedAt: 'Last check',
    linkedAt: 'Linked',
    notYet: 'Not yet',
    badAuthTitle: 'The authentication code does not work',
    badAuthText: 'Steam refused the code: it was revoked or replaced. Get a new code on Steam and enter it below.',
    badShareTitle: 'The match sharing code does not fit',
    badShareText:
      'The last code is not a match of this account, or it is too old. Get the code of your last match from Steam and enter it below.',
    unlink: 'Unlink',
    unlinkQuestion: 'Unlink? New matches will stop coming.',
    unlinkYes: 'Yes, unlink',
    unlinkNo: 'No',
  },
}
