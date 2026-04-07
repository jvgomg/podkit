import React from 'react';
import type { ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  currentTrackAtom,
  positionAtom,
  durationAtom,
  volumeAtom,
  currentQueuePositionAtom,
} from '../../store/playback.js';
import { nowPlayingModeAtom, volumeOverlayVisibleAtom } from '../../store/now-playing-mode.js';
import { ProgressBar } from '../shared/ProgressBar.js';
import { useHeaderTitle } from '../../hooks/useHeaderTitle.js';
import { useTrackArtwork } from '../../hooks/useTrackArtwork.js';
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
// Layout
// ---------------------------------------------------------------------------

/** Fixed layout with a main area and a bottom slot that never changes height. */
function NowPlayingLayout({
  children,
  bottom,
  className,
}: {
  children: ReactNode;
  bottom: ReactNode;
  className?: string;
}) {
  return (
    <div className={`now-playing${className ? ` ${className}` : ''}`}>
      <div className="np-body">{children}</div>
      {bottom !== null && <div className="np-bottom">{bottom}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

function ArtworkDisplay({ trackId }: { trackId: number }) {
  const artworkUrl = useTrackArtwork(trackId);

  if (artworkUrl) {
    return <img src={artworkUrl} className="np-artwork-image" alt="" />;
  }

  return (
    <div className="np-artwork-placeholder">
      <span className="np-music-note">{'\u266B'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom slot contents
// ---------------------------------------------------------------------------

function Scrubber({ scrubbing }: { scrubbing?: boolean }) {
  const position = useAtomValue(positionAtom);
  const duration = useAtomValue(durationAtom);
  const progress = duration > 0 ? position / duration : 0;

  return (
    <ProgressBar
      progress={progress}
      leftLabel={formatTime(position)}
      rightLabel={`-${formatTime(duration - position)}`}
      className={`np-scrubber${scrubbing ? ' np-scrubber--scrubbing' : ''}`}
    />
  );
}

function VolumeBar() {
  const volume = useAtomValue(volumeAtom);
  return <ProgressBar progress={volume / 100} leftLabel="Volume" />;
}

// ---------------------------------------------------------------------------
// Sub-screens
// ---------------------------------------------------------------------------

function TrackInfoView({ scrubbing }: { scrubbing?: boolean }) {
  const track = useAtomValue(currentTrackAtom)!;
  const queuePos = useAtomValue(currentQueuePositionAtom);
  const showVolume = useAtomValue(volumeOverlayVisibleAtom);

  return (
    <NowPlayingLayout bottom={showVolume ? <VolumeBar /> : <Scrubber scrubbing={scrubbing} />}>
      <div className="np-queue-info">
        {queuePos.current} of {queuePos.total}
      </div>
      <div className="np-main">
        <div className="np-artwork">
          <ArtworkDisplay trackId={track.id} />
        </div>
        <div className="np-track-info">
          <div className="np-title">{track.title}</div>
          <div className="np-artist">{track.artist}</div>
          <div className="np-album">{track.album}</div>
        </div>
      </div>
    </NowPlayingLayout>
  );
}

function ArtworkView() {
  const track = useAtomValue(currentTrackAtom)!;
  const showVolume = useAtomValue(volumeOverlayVisibleAtom);

  return (
    <NowPlayingLayout className="now-playing--artwork" bottom={showVolume ? <VolumeBar /> : null}>
      <div className="np-artwork-fullscreen">
        <ArtworkDisplay trackId={track.id} />
      </div>
    </NowPlayingLayout>
  );
}

// ---------------------------------------------------------------------------
// NowPlaying
// ---------------------------------------------------------------------------

export function NowPlaying() {
  const track = useAtomValue(currentTrackAtom);
  const mode = useAtomValue(nowPlayingModeAtom);

  useHeaderTitle('Now Playing');

  if (!track) {
    return <div className="now-playing-empty">No track selected</div>;
  }

  switch (mode) {
    case 'scrubbing':
      return <TrackInfoView scrubbing />;
    case 'artwork':
      return <ArtworkView />;
    default:
      return <TrackInfoView />;
  }
}
