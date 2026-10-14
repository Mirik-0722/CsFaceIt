import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * `sm` is the 32px circle of a line of text, `default` the card of a search result, `lg` the header of a profile (72px
 * on a phone, 96px from `sm`).
 */
export type AvatarSize = 'sm' | 'default' | 'lg'

const BOX: Record<AvatarSize, string> = {
  sm: 'size-8 bg-border text-[13px]',
  default: 'size-14 bg-secondary text-xl',
  lg: 'size-18 bg-secondary text-[28px] sm:size-24 sm:text-[36px]',
}

interface PlayerAvatarProps {
  nickname: string
  /** FACEIT's picture; none for a player without one, and while the player is still being asked for. */
  avatar?: string | null
  size: AvatarSize
}

/**
 * The picture of the player; the initial of the nickname in a circle of the same size when he has none, or when the
 * picture does not load, so that the circle is there before the picture is known.
 */
export default function PlayerAvatar({ nickname, avatar, size }: PlayerAvatarProps) {
  // The address that failed, not a flag: another player's address (this component is reused for the next player)
  // is tried afresh, and fails to the initial in its turn.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (avatar && avatar !== failedSrc) {
    return (
      <img
        src={avatar}
        alt=""
        onError={() => setFailedSrc(avatar)}
        className={cn(BOX[size], 'shrink-0 rounded-full object-cover')}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        BOX[size],
        'flex shrink-0 items-center justify-center rounded-full border border-line-strong font-semibold',
      )}
    >
      {nickname.charAt(0).toUpperCase()}
    </div>
  )
}
