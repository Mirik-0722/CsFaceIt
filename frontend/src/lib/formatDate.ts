const dateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

/** An ISO-8601 instant as `01 Oct 2026`: a fixed locale, in the viewer's time zone. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}
