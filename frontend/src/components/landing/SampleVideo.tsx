import { useEffect, useRef, useState } from 'react'
import { sampleClipSources } from '@/lib/sampleClip'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { useTabHidden } from '@/lib/useTabHidden'

// Known when the page is built, so it is read once, not on every render.
const SOURCES = sampleClipSources()

/**
 * The sample's video, filling the frame under its labels (it is only drawn when a clip is in `src/assets/landing/`).
 * It is decoration: muted, no controls, out of the keyboard's way and never announced. It starts by itself, loops, and
 * is paused while the frame is out of view or the tab is in the background; `preload="metadata"` keeps the page light
 * until it plays. A visitor who asked for less motion gets the poster only, the scenery of the clip's own map, as a
 * plain picture: the video is not even fetched.
 */
export default function SampleVideo({ poster }: { poster: string | null }) {
  const reducedMotion = usePrefersReducedMotion()
  const tabHidden = useTabHidden()
  const video = useRef<HTMLVideoElement>(null)
  // Without an observer there is no telling, and the video plays.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  const playing = !reducedMotion && inView && !tabHidden

  useEffect(() => {
    const element = video.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [reducedMotion])

  useEffect(() => {
    const element = video.current
    if (!element) {
      return
    }
    if (playing) {
      // The browser may refuse to start a video by itself; the poster then stays, which is the calm picture, and nothing
      // is shown or logged. It is asked again the next time `playing` turns true: that is whenever the frame comes into
      // view again or the tab becomes visible again (a refusal that outlasts them is not fought: no loop, no timer).
      void element.play().catch(() => undefined)
    } else {
      element.pause()
    }
  }, [playing])

  return (
    <>
      {reducedMotion ? (
        poster && <img src={poster} alt="" decoding="async" className="absolute inset-0 size-full object-cover object-[50%_40%]" />
      ) : (
        <video
          ref={video}
          poster={poster ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
        >
          {SOURCES.map((source) => (
            <source key={source.type} src={source.src} type={source.type} />
          ))}
        </video>
      )}
      <div aria-hidden="true" className="scenery-veil-sample absolute inset-0" />
    </>
  )
}
