// One request per picture, however often it is asked for: the answer is kept by URL.
const pictures = new Map<string, Promise<boolean>>()

// How long a picture is waited for. A request that neither loads nor fails would keep whoever waits for it waiting for
// minutes; after this the picture counts as one that did not arrive.
const WAIT_MS = 3000

/**
 * Fetches a picture ahead of the element that will show it, so that the element has it at once: it resolves when the
 * picture has arrived and been decoded (where the browser can decode ahead; elsewhere on its arrival), so that showing
 * it never paints a half-ready picture. Resolves to whether the picture arrived within `WAIT_MS`; it never rejects. A
 * picture that did not arrive, or not in time, is forgotten, so that asking again tries again.
 */
export function loadImage(url: string): Promise<boolean> {
  let picture = pictures.get(url)
  if (!picture) {
    picture = new Promise<boolean>((resolve) => {
      const image = new Image()
      // Only the first answer counts (`resolve` keeps the first); a late one must not forget a newer request's entry.
      const finish = (arrived: boolean) => {
        clearTimeout(timer)
        if (!arrived && pictures.get(url) === picture) {
          pictures.delete(url)
        }
        resolve(arrived)
      }
      const timer = setTimeout(() => finish(false), WAIT_MS)
      image.onload = () => {
        const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve()
        // A picture that arrived but cannot be decoded ahead is still shown: the element decodes it itself.
        void decoded.catch(() => undefined).then(() => finish(true))
      }
      image.onerror = () => finish(false)
      image.src = url
    })
    pictures.set(url, picture)
  }
  return picture
}
