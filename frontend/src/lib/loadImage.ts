// One request per picture, however often it is asked for: the answer is kept by URL.
const pictures = new Map<string, Promise<boolean>>()

/**
 * Fetches a picture ahead of the element that will show it, so that the element has it at once. Resolves to whether the
 * picture arrived; it never rejects. A picture that did not arrive is forgotten, so that asking again tries again.
 */
export function loadImage(url: string): Promise<boolean> {
  let picture = pictures.get(url)
  if (!picture) {
    picture = new Promise<boolean>((resolve) => {
      const image = new Image()
      image.onload = () => resolve(true)
      image.onerror = () => {
        pictures.delete(url)
        resolve(false)
      }
      image.src = url
    })
    pictures.set(url, picture)
  }
  return picture
}
