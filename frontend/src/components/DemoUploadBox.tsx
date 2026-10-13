import { Upload } from 'lucide-react'
import { type FormEvent, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { nextPossible } from '@/lib/limits'
import { useViewer } from '@/lib/viewer'

interface DemoUploadBoxProps {
  /** A file chosen here: its match is the one its name names. */
  onFile: (file: File) => void
  /** A pasted link: its match is the one the file at its end names. True when it was taken, false when refused at once. */
  onLink: (link: string) => boolean
}

/**
 * The box of the matches page where a signed-in player brings a demo in (spec 3, `DemoUploadBox`): a title, one line of
 * how, "Choose a file" and a field for a link beside it. A file dropped anywhere on the page does what the button does;
 * how each goes is told in the feed over the rows, not here. A used-up day's limit turns the matching control off and
 * says when it frees up.
 */
export default function DemoUploadBox({ onFile, onLink }: DemoUploadBoxProps) {
  const t = useT()
  const { limits } = useViewer()
  const fileInput = useRef<HTMLInputElement>(null)
  const linkId = useId()
  const [link, setLink] = useState('')
  const uploadsOut = limits !== null && limits.demoUploads.remaining <= 0
  const importsOut = limits !== null && limits.demoImports.remaining <= 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (link.trim() === '') {
      return
    }
    // A link that was refused at once stays in the field, to be put right.
    if (onLink(link)) {
      setLink('')
    }
  }

  return (
    <section className="flex flex-col gap-3.5 border border-dashed border-line-strong bg-card p-5">
      <h2 className="label-mono font-medium">{t.matches.bring.title}</h2>
      <p className="text-sm leading-normal text-muted-foreground">{t.matches.bring.text}</p>
      <input
        ref={fileInput}
        type="file"
        accept=".dem,.gz,.zst"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          for (const file of event.target.files ?? []) {
            onFile(file)
          }
          // The same file chosen again after a failure is a new choice.
          event.target.value = ''
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={uploadsOut}
        onClick={() => fileInput.current?.click()}
      >
        <Upload aria-hidden="true" />
        {t.matches.bring.choose}
      </Button>
      {uploadsOut && limits && (
        <p className="text-sm leading-normal">
          {t.limits.UPLOAD_LIMIT_REACHED(nextPossible(limits.demoUploads.resetsAt, t))}
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={linkId} className="sr-only">
          {t.matches.bring.linkLabel}
        </label>
        <div className="flex gap-2">
          <Input
            id={linkId}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t.matches.bring.linkPlaceholder}
            value={link}
            disabled={importsOut}
            onChange={(event) => setLink(event.target.value)}
            // 16px: a smaller text makes a phone zoom in when the field is focused.
            className="text-base sm:text-sm"
          />
          <Button type="submit" variant="outline" disabled={importsOut || link.trim() === ''}>
            {t.matches.bring.linkSubmit}
          </Button>
        </div>
        {importsOut && limits && (
          <p className="text-sm leading-normal">
            {t.limits.IMPORT_LIMIT_REACHED(nextPossible(limits.demoImports.resetsAt, t))}
          </p>
        )}
      </form>
    </section>
  )
}
