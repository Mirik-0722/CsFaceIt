import { useState } from 'react'

/**
 * Whether the picture at `url` has arrived, and what tells it so (the picture's `onLoad`). The address that arrived is
 * kept, not a flag: another address (another map's picture) is waited for afresh.
 */
export function useLoadedUrl(url: string | null): [shown: boolean, onLoad: () => void] {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  return [!!url && loadedUrl === url, () => setLoadedUrl(url)]
}
