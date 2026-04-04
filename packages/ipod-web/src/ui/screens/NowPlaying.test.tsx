import { describe, test, expect, afterEach } from 'bun:test';
import React from 'react';
import { render, cleanup, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { NowPlaying } from './NowPlaying.js';
import {
  currentTrackAtom,
  positionAtom,
  durationAtom,
  queueAtom,
  queueIndexAtom,
} from '../../store/playback.js';
import type { Track } from '../../firmware/types.js';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: 'Song',
    artist: '',
    album: '',
    genre: '',
    duration: 0,
    trackNumber: 0,
    ...overrides,
  };
}

function renderWithStore(store: ReturnType<typeof createStore>) {
  return render(
    <Provider store={store}>
      <NowPlaying />
    </Provider>
  );
}

describe('NowPlaying', () => {
  afterEach(cleanup);

  test('shows "No track selected" when no track', () => {
    const store = createStore();
    const { getByText } = renderWithStore(store);
    expect(getByText('No track selected')).toBeTruthy();
  });

  test('displays track title, artist, album', () => {
    const store = createStore();
    const track = makeTrack({
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
    });
    store.set(currentTrackAtom, track);
    store.set(queueAtom, [track]);
    const { getByText } = renderWithStore(store);
    expect(getByText('Test Song')).toBeTruthy();
    expect(getByText('Test Artist')).toBeTruthy();
    expect(getByText('Test Album')).toBeTruthy();
  });

  test('displays queue position', () => {
    const store = createStore();
    const tracks = [makeTrack({ id: 1 }), makeTrack({ id: 2 }), makeTrack({ id: 3 })];
    store.set(currentTrackAtom, tracks[1]!);
    store.set(queueAtom, tracks);
    store.set(queueIndexAtom, 1);
    const { getByText } = renderWithStore(store);
    expect(getByText('2 of 3')).toBeTruthy();
  });

  test('shows music note when no artwork', () => {
    const store = createStore();
    store.set(currentTrackAtom, makeTrack());
    const { container } = renderWithStore(store);
    const scoped = within(container);
    expect(scoped.getByText('\u266B')).toBeTruthy();
  });

  test('formats time correctly', () => {
    const store = createStore();
    store.set(currentTrackAtom, makeTrack());
    store.set(positionAtom, 83); // 1:23
    store.set(durationAtom, 240); // 4:00
    const { container } = renderWithStore(store);
    const scoped = within(container);
    expect(scoped.getByText('1:23')).toBeTruthy();
    expect(scoped.getByText('-2:37')).toBeTruthy();
  });

  test('scrubber shows 0:00 when no duration', () => {
    const store = createStore();
    store.set(currentTrackAtom, makeTrack());
    store.set(positionAtom, 0);
    store.set(durationAtom, 0);
    const { container } = renderWithStore(store);
    const scoped = within(container);
    expect(scoped.getByText('0:00')).toBeTruthy();
    expect(scoped.getByText('-0:00')).toBeTruthy();
  });
});
