/**
 * Thin wrapper around an HTML <audio> element.
 *
 * Works in both browser and Tauri WebView environments.
 */
export class AudioPlayer {
  private audio: HTMLAudioElement;

  constructor() {
    this.audio = new Audio();
  }

  async play(url: string): Promise<void> {
    this.audio.src = url;
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
  }
}
