import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionTitleProps {
  /** What the section names itself by (`aria-labelledby`). */
  id: string
  className?: string
  children: ReactNode
}

/**
 * The `h2` of a section of the landing page. It is larger than `heading-section`, the 22px title of a block on an app
 * page: the landing page is read like a poster, and the mockup sets its section titles between 26px and 34px.
 */
export default function SectionTitle({ id, className, children }: SectionTitleProps) {
  return (
    <h2
      id={id}
      className={cn(
        'text-[clamp(26px,2.6vw,34px)] leading-[1.15] font-semibold tracking-[-0.02em] text-balance',
        className,
      )}
    >
      {children}
    </h2>
  )
}
