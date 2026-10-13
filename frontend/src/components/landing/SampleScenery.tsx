import { cn } from '@/lib/utils'
import { TURN_MS } from './useMapTurn'
import { fade, type SceneStack } from './useSceneStack'

/**
 * What the sample's frame shows until there is a video of it: the scenery of the active map, sharp, in step with the
 * page's backdrop (it draws the same stack of pictures, so it changes at the same moment, with the same fade, and the
 * file is fetched once). While a map is active its picture drifts: it settles from a slightly closer view over the
 * length of a turn (`animate-scene-drift`), and waits where it is while the turn is held. A visitor who asked for less
 * motion gets neither the drift nor the fade.
 *
 * The fade is on a box of its own around each picture: both are animations, and a single element can run only one of
 * them under the utilities that name them. The picture that was on top goes on drifting when it goes underneath, so
 * that nothing jumps when the next one comes in. Over it all lies the veil that the frame's own texts need.
 */
export default function SampleScenery({ scenes, paused }: { scenes: SceneStack; paused: boolean }) {
  return (
    <>
      {[scenes.under, scenes.over].map(
        (url) =>
          url && (
            <div key={url} className={cn('absolute inset-0', fade(scenes, url))}>
              <img
                src={url}
                alt=""
                decoding="async"
                onLoad={url === scenes.first ? scenes.onFirstArrived : undefined}
                className="size-full origin-[50%_40%] animate-scene-drift object-cover object-[50%_40%]"
                style={{ animationDuration: `${TURN_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
              />
            </div>
          ),
      )}
      <div aria-hidden="true" className="scenery-veil-sample absolute inset-0" />
    </>
  )
}
