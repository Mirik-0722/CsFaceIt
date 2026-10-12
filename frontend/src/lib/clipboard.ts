/**
 * Puts `text` on the clipboard and says whether it worked. The clipboard API exists only on a secure origin (https or
 * localhost); elsewhere the text is copied the old way, through a selection in a field that is never seen.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // The selection below takes the focus; afterwards it goes back to where it was, the button that asked for the copy.
    const focused = document.activeElement
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      field.remove()
      if (focused instanceof HTMLElement) {
        focused.focus()
      }
    }
  }
}
