import type { JukeboxQueueItem } from '@/shared/types/queue'

/**
 * Sorts queue items by votes (descending) and queued_at (ascending)
 * This matches the database ordering used in the API
 */
export function sortQueueByPriority(
  queue: JukeboxQueueItem[]
): JukeboxQueueItem[] {
  return [...queue].sort((a, b) => {
    // First sort by votes (descending - higher votes first)
    if (b.votes !== a.votes) {
      return b.votes - a.votes
    }

    // If votes are equal, sort by queued_at (ascending - earlier queued first)
    const aTime = new Date(a.queued_at).getTime()
    const bTime = new Date(b.queued_at).getTime()
    return aTime - bTime
  })
}
