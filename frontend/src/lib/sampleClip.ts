/**
 * The sample clip of the landing page: a video the owner may put in `src/assets/landing/` (see the README there). It
 * is optional. The files are looked up when the page is built, so a missing file is simply not in the lookup, and
 * nothing breaks. The build gives each one a hashed name; `no-inline` keeps it a file whatever its size.
 */
const FILES = import.meta.glob<string>('../assets/landing/sample-clip.{webm,mp4}', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
})

export interface SampleClipSource {
  src: string
  type: string
}

/** The files of the clip in the order a browser should try them (WebM first), or none when there is no clip. */
export function sampleClipSources(): SampleClipSource[] {
  const sources: SampleClipSource[] = []
  for (const [extension, type] of [
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ] as const) {
    const path = Object.keys(FILES).find((file) => file.endsWith(`.${extension}`))
    if (path) {
      sources.push({ src: FILES[path], type })
    }
  }
  return sources
}
