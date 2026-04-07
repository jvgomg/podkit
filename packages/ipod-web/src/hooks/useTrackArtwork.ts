import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { databaseAtom } from '../store/database.js';

/**
 * Convert RGBA pixel data to a blob URL suitable for <img src>.
 * Uses an OffscreenCanvas (or falls back to a regular canvas) to encode as PNG.
 */
function rgbaToObjectUrl(data: Uint8Array, width: number, height: number): Promise<string> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    const imageData = new ImageData(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width,
      height
    );
    ctx.putImageData(imageData, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' }).then((blob) => URL.createObjectURL(blob));
  }

  // Fallback for environments without OffscreenCanvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = new ImageData(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width,
    height
  );
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(URL.createObjectURL(blob!));
    }, 'image/png');
  });
}

/**
 * Returns a blob URL for a track's artwork image, or null if unavailable.
 * Caches by trackId and revokes URLs on unmount.
 */
export function useTrackArtwork(trackId: number): string | null {
  const database = useAtomValue(databaseAtom);
  const [url, setUrl] = useState<string | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    if (!database) {
      setUrl(null);
      return;
    }

    const cached = cacheRef.current.get(trackId);
    if (cached) {
      setUrl(cached);
      return;
    }

    const decoded = database.getTrackArtwork(trackId);
    if (!decoded) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    rgbaToObjectUrl(decoded.data, decoded.width, decoded.height).then((objectUrl) => {
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      cacheRef.current.set(trackId, objectUrl);
      setUrl(objectUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [database, trackId]);

  // Revoke all cached URLs on unmount
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const objectUrl of cache.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      cache.clear();
    };
  }, []);

  return url;
}
