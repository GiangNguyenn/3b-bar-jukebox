// Shared utility for tracking duplicate track processing
export class TrackDuplicateDetector {
  private lastProcessedTrackId: string | null = null
  private lastKnownPlayingTrackId: string | null = null

  shouldProcessTrack(currentTrackId: string | null | undefined): boolean {
    if (!currentTrackId) return false

    // Reset if track changed
    if (this.lastKnownPlayingTrackId !== currentTrackId) {
      this.lastProcessedTrackId = null
      this.lastKnownPlayingTrackId = currentTrackId
      return true
    }

    // Prevent duplicate processing
    if (this.lastProcessedTrackId === currentTrackId) {
      return false
    }

    this.lastProcessedTrackId = currentTrackId
    return true
  }

  reset(): void {
    this.lastProcessedTrackId = null
    this.lastKnownPlayingTrackId = null
  }

  getLastProcessedTrackId(): string | null {
    return this.lastProcessedTrackId
  }

  getLastKnownPlayingTrackId(): string | null {
    return this.lastKnownPlayingTrackId
  }

  // Method to set the last known playing track without processing
  setLastKnownPlayingTrack(trackId: string | null): void {
    if (trackId !== this.lastKnownPlayingTrackId) {
      this.lastProcessedTrackId = null
      this.lastKnownPlayingTrackId = trackId
    }
  }
}
