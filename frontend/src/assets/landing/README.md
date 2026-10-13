# Landing page assets

## `sample-clip.mp4` (optional): the video in the hero's sample frame

The sample on the landing page shows a frame of the game. Until a video is put here, the frame shows the scenery of the
map whose turn it is, drifting slowly. When this folder has a clip, the clip plays in the frame instead:

- `sample-clip.mp4` is the clip. Put it here under exactly that name.
- `sample-clip.webm` is optional, a second encoding of the same clip. Browsers are offered it first, and the MP4 is the
  fallback.

The files are looked up when the page is built (`src/lib/sampleClip.ts`), so a build without them is as it always was:
nothing has to be switched on or off. Rebuild (or restart `npm run dev`) after adding, replacing or removing a file.

### Limits to keep

The clip is fetched by every visitor of the landing page, so it is small:

- H.264 video in an MP4 container (`yuv420p`, `+faststart`), which every browser plays. A WebM, if there is one, is
  VP9 or AV1.
- 16:9, 1280x720 is enough (the frame is never wider than about 700 px).
- At most about 15 seconds, and at most about 2 MB. It plays muted and loops.
- No sound track at all (leave it out when encoding, for example `ffmpeg -an`): the video is always muted, and a
  silent file is smaller.

For example: `ffmpeg -i recording.mp4 -an -vf scale=1280:-2 -r 30 -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p
-movflags +faststart -t 15 sample-clip.mp4`.

### After replacing the file

The corner label and the caption under the frame describe the clip, not the map that is turning. They are made from
`SAMPLE_CLIP` in `src/components/landing/HeroIllustration.tsx` (the map and round, who got the kills and with what, the
length, the size and where the kills are in the clip). Its values today are those of the drawn sample; edit them to say
what is in the new file. With a clip in place the frame draws no kill feed and no crosshair: the video has its own.

### Whose footage it is

A clip of the game is Valve's content. It is recorded by the owner of the site and shown here as a sample of what the
product makes; it is not something the repository or its licence covers.
