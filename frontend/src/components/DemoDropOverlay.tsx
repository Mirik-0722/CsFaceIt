import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'

/** Whether a drag carries files (and not, say, a piece of selected text). */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Makes the whole page a place to drop demo files on: while files are dragged over it a dashed frame with one line
 * says so, and a drop hands the files to `onFiles`. The page's own drop is always taken (a file let go anywhere else
 * would make the browser open it and leave the site). Where there is nobody to take the files, the page does not
 * mount this.
 */
export default function DemoDropOverlay({ onFiles }: { onFiles: (files: File[]) => void }) {
  const t = useT()
  const [dragging, setDragging] = useState(false)
  // The newest callback, so that the listeners are put up once.
  const take = useRef(onFiles)
  useEffect(() => {
    take.current = onFiles
  })

  useEffect(() => {
    function over(event: DragEvent) {
      if (carriesFiles(event)) {
        event.preventDefault()
        setDragging(true)
      }
    }
    function leave(event: DragEvent) {
      // Leaving the window has no element to go to; moving between elements of the page does.
      if (event.relatedTarget === null) {
        setDragging(false)
      }
    }
    function drop(event: DragEvent) {
      if (!carriesFiles(event)) {
        return
      }
      event.preventDefault()
      setDragging(false)
      take.current(Array.from(event.dataTransfer?.files ?? []))
    }
    document.addEventListener('dragenter', over)
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('dragenter', over)
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
    }
  }, [])

  if (!dragging) {
    return null
  }
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center border-2 border-dashed border-foreground bg-background/80"
    >
      <p className="px-6 text-center font-mono text-sm tracking-[0.08em] uppercase">{t.matches.bring.drop}</p>
    </div>
  )
}
