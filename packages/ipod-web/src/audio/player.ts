/**
 * Thin wrapper around an HTML <audio> element.
 *
 * Works in both browser and Tauri WebView environments.
 * Audio is fetched as a blob to avoid cross-origin media restrictions
 * in WebViews (Tauri dev server runs on a different port from the API).
 */
export class AudioPlayer {
  private audio: HTMLAudioElement;
  private currentObjectUrl: string | null = null;

  constructor() {
    this.audio = new Audio();
  }

  async play(url: string): Promise<void> {
    this.revokeObjectUrl();

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Audio fetch failed: ${response.status} ${response.statusText} (src: ${url})`
      );
    }

    const blob = await response.blob();
    this.currentObjectUrl = URL.createObjectURL(blob);
    this.audio.src = this.currentObjectUrl;

    // Wait for enough data to start playback, or an error
    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        const e = this.audio.error;
        const detail = e ? `code=${e.code} message=${e.message}` : 'unknown';
        reject(new Error(`Audio decode failed: ${detail}`));
      };
      const cleanup = () => {
        this.audio.removeEventListener('canplay', onCanPlay);
        this.audio.removeEventListener('error', onError);
      };
      this.audio.addEventListener('canplay', onCanPlay, { once: true });
      this.audio.addEventListener('error', onError, { once: true });
      this.audio.load();
    });

    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    this.audio.play();
  }

  seek(seconds: number): void {
    this.audio.currentTime = seconds;
  }

  setVolume(level: number): void {
    // level: 0-100, audio.volume: 0-1
    this.audio.volume = Math.max(0, Math.min(1, level / 100));
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get duration(): number {
    return this.audio.duration || 0;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  onTimeUpdate(cb: () => void): void {
    this.audio.addEventListener('timeupdate', cb);
  }

  onEnded(cb: () => void): void {
    this.audio.addEventListener('ended', cb);
  }

  onError(cb: (e: Event) => void): void {
    this.audio.addEventListener('error', cb);
  }

  destroy(): void {
    this.audio.pause();
    this.audio.src = '';
    this.audio.removeAttribute('src');
    this.revokeObjectUrl();
  }

  private revokeObjectUrl(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }
}
