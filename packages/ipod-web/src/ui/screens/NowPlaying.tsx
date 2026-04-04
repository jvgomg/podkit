import React from 'react';
import { useAtomValue } from 'jotai';
import {
  currentTrackAtom,
  positionAtom,
  durationAtom,
  currentQueuePositionAtom,
} from '../../store/playback.js';
import { ProgressBar } from '../shared/ProgressBar.js';
import './NowPlaying.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

function ArtworkDisplay(_props: { trackId: number }) {
  // Artwork is not yet available (no artwork in fixtures).
  // When artwork support lands, this will call IpodReader.getTrackArtwork().
  return (
    <div className="np-artwork-container">
      <div className="np-artwork-placeholder">
        <span className="np-music-note">{'\u266B'}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NowPlaying
// ---------------------------------------------------------------------------

export function NowPlaying() {
  const track = useAtomValue(currentTrackAtom);
  const position = useAtomValue(positionAtom);
  const duration = useAtomValue(durationAtom);
  const queuePos = useAtomValue(currentQueuePositionAtom);

  if (!track) {
    return <div className="now-playing-empty">No track selected</div>;
  }

  const progress = duration > 0 ? position / duration : 0;
  const elapsed = formatTime(position);
  const remaining = `-${formatTime(duration - position)}`;

  return (
    <div className="now-playing">
      {/* Queue position header */}
      <div className="np-queue-info">
        <span>{'\u25C0\u25C0'}</span>
        <span>
          {queuePos.current} of {queuePos.total}
        </span>
        <span>{'\u25B6\u25B6'}</span>
      </div>

      {/* Album artwork */}
      <div className="np-artwork">
        <ArtworkDisplay trackId={track.id} />
      </div>

      {/* Track info */}
      <div className="np-track-info">
        <div className="np-title">{track.title}</div>
        <div className="np-artist">{track.artist}</div>
        <div className="np-album">{track.album}</div>
      </div>

      {/* Scrubber */}
      <ProgressBar
        progress={progress}
        leftLabel={elapsed}
        rightLabel={remaining}
        className="np-scrubber"
      />
    </div>
  );
}
