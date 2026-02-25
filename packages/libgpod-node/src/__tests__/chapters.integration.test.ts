/**
 * Integration tests for libgpod-node chapter data operations.
 *
 * Chapter data is used for podcasts and audiobooks to provide navigation
 * points within a track.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect } from 'bun:test';

import {
  withTestIpod,
  Database,
  MediaType,
  LibgpodError,
} from './helpers/test-setup';

describe('libgpod-node chapter data (getTrackChapters, setTrackChapters)', () => {
  it('can get chapters from a track without chapters', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'No Chapters',
        mediaType: MediaType.Podcast,
      });

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toEqual([]);

      db.close();
    });
  });

  it('can set chapters on a track', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Podcast Episode',
        mediaType: MediaType.Podcast,
        duration: 3600000, // 1 hour
      });

      const chapters = db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Introduction' },
        { startPos: 60000, title: 'Topic 1' },
        { startPos: 300000, title: 'Topic 2' },
        { startPos: 600000, title: 'Conclusion' },
      ]);

      expect(chapters).toHaveLength(4);
      // First chapter startPos 0 becomes 1 in libgpod
      expect(chapters[0]!.startPos).toBe(1);
      expect(chapters[0]!.title).toBe('Introduction');
      expect(chapters[1]!.startPos).toBe(60000);
      expect(chapters[1]!.title).toBe('Topic 1');
      expect(chapters[2]!.startPos).toBe(300000);
      expect(chapters[2]!.title).toBe('Topic 2');
      expect(chapters[3]!.startPos).toBe(600000);
      expect(chapters[3]!.title).toBe('Conclusion');

      db.close();
    });
  });

  it('can get chapters after setting them', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Chapter Test',
        mediaType: MediaType.Audiobook,
      });

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Chapter 1' },
        { startPos: 120000, title: 'Chapter 2' },
      ]);

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toHaveLength(2);
      expect(chapters[0]!.title).toBe('Chapter 1');
      expect(chapters[1]!.title).toBe('Chapter 2');

      db.close();
    });
  });

  it('setTrackChapters replaces existing chapters', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Replace Test',
        mediaType: MediaType.Podcast,
      });

      // Set initial chapters
      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Old Chapter 1' },
        { startPos: 60000, title: 'Old Chapter 2' },
        { startPos: 120000, title: 'Old Chapter 3' },
      ]);

      expect(db.getTrackChapters(track.id)).toHaveLength(3);

      // Replace with new chapters
      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'New Chapter A' },
        { startPos: 180000, title: 'New Chapter B' },
      ]);

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toHaveLength(2);
      expect(chapters[0]!.title).toBe('New Chapter A');
      expect(chapters[1]!.title).toBe('New Chapter B');

      db.close();
    });
  });

  it('setTrackChapters with empty array clears chapters', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Clear Test',
        mediaType: MediaType.Podcast,
      });

      // Set initial chapters
      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Chapter 1' },
        { startPos: 60000, title: 'Chapter 2' },
      ]);

      expect(db.getTrackChapters(track.id)).toHaveLength(2);

      // Clear with empty array
      db.setTrackChapters(track.id, []);
      expect(db.getTrackChapters(track.id)).toHaveLength(0);

      db.close();
    });
  });

  it('throws error for invalid track ID', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      expect(() => {
        db.getTrackChapters(99999);
      }).toThrow(LibgpodError);

      expect(() => {
        db.setTrackChapters(99999, [{ startPos: 0, title: 'Test' }]);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('chapters persist after save and reopen', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Persistence Test',
        mediaType: MediaType.Podcast,
        duration: 600000,
      });

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Intro' },
        { startPos: 120000, title: 'Main Content' },
        { startPos: 480000, title: 'Outro' },
      ]);

      db.saveSync();
      db.close();

      // Reopen and verify
      const db2 = Database.openSync(ipod.path);
      const tracks = db2.getTracks();
      expect(tracks).toHaveLength(1);

      const chapters = db2.getTrackChapters(tracks[0]!.id);
      expect(chapters).toHaveLength(3);
      expect(chapters[0]!.title).toBe('Intro');
      expect(chapters[1]!.title).toBe('Main Content');
      expect(chapters[1]!.startPos).toBe(120000);
      expect(chapters[2]!.title).toBe('Outro');

      db2.close();
    });
  });
});

describe('libgpod-node chapter data (addTrackChapter)', () => {
  it('can add chapters one at a time', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Add Chapter Test',
        mediaType: MediaType.Audiobook,
      });

      db.addTrackChapter(track.id, 0, 'Chapter 1');
      db.addTrackChapter(track.id, 120000, 'Chapter 2');
      db.addTrackChapter(track.id, 240000, 'Chapter 3');

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toHaveLength(3);
      expect(chapters[0]!.title).toBe('Chapter 1');
      expect(chapters[1]!.title).toBe('Chapter 2');
      expect(chapters[2]!.title).toBe('Chapter 3');

      db.close();
    });
  });

  it('addTrackChapter returns all chapters', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Return Test',
        mediaType: MediaType.Podcast,
      });

      const result1 = db.addTrackChapter(track.id, 0, 'First');
      expect(result1).toHaveLength(1);

      const result2 = db.addTrackChapter(track.id, 60000, 'Second');
      expect(result2).toHaveLength(2);

      const result3 = db.addTrackChapter(track.id, 120000, 'Third');
      expect(result3).toHaveLength(3);

      db.close();
    });
  });

  it('throws error for invalid track ID', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      expect(() => {
        db.addTrackChapter(99999, 0, 'Test');
      }).toThrow(LibgpodError);

      db.close();
    });
  });
});

describe('libgpod-node chapter data (clearTrackChapters)', () => {
  it('can clear all chapters from a track', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Clear Test',
        mediaType: MediaType.Podcast,
      });

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Chapter 1' },
        { startPos: 60000, title: 'Chapter 2' },
        { startPos: 120000, title: 'Chapter 3' },
      ]);

      expect(db.getTrackChapters(track.id)).toHaveLength(3);

      db.clearTrackChapters(track.id);

      expect(db.getTrackChapters(track.id)).toHaveLength(0);

      db.close();
    });
  });

  it(
    'clearTrackChapters is idempotent (works on track without chapters)',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({
          title: 'No Chapters',
          mediaType: MediaType.Podcast,
        });

        // Should not throw
        db.clearTrackChapters(track.id);
        expect(db.getTrackChapters(track.id)).toHaveLength(0);

        // Call again - should still not throw
        db.clearTrackChapters(track.id);
        expect(db.getTrackChapters(track.id)).toHaveLength(0);

        db.close();
      });
    }
  );

  it('throws error for invalid track ID', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      expect(() => {
        db.clearTrackChapters(99999);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('cleared chapters persist after save', async () => {
    await withTestIpod(async (ipod) => {
      // First, create a track with chapters and save
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Clear Persist Test',
        mediaType: MediaType.Audiobook,
      });

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Chapter 1' },
        { startPos: 60000, title: 'Chapter 2' },
      ]);

      db.saveSync();
      db.close();

      // Reopen to get valid track ID, verify chapters exist
      const db2 = Database.openSync(ipod.path);
      const tracks = db2.getTracks();
      expect(tracks).toHaveLength(1);
      expect(db2.getTrackChapters(tracks[0]!.id)).toHaveLength(2);

      // Clear and save
      db2.clearTrackChapters(tracks[0]!.id);
      db2.saveSync();
      db2.close();

      // Reopen and verify cleared
      const db3 = Database.openSync(ipod.path);
      const tracks2 = db3.getTracks();
      expect(db3.getTrackChapters(tracks2[0]!.id)).toHaveLength(0);

      db3.close();
    });
  });
});

describe('libgpod-node chapter data edge cases', () => {
  it('can set a single chapter', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Single Chapter Test',
        mediaType: MediaType.Podcast,
        duration: 300000, // 5 minutes
      });

      const chapters = db.setTrackChapters(track.id, [
        { startPos: 0, title: 'The Only Chapter' },
      ]);

      expect(chapters).toHaveLength(1);
      expect(chapters[0]!.startPos).toBe(1); // 0 becomes 1 in libgpod
      expect(chapters[0]!.title).toBe('The Only Chapter');

      db.close();
    });
  });

  it('handles chapter with empty title', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Empty Title Test',
        mediaType: MediaType.Podcast,
      });

      const chapters = db.setTrackChapters(track.id, [
        { startPos: 0, title: '' },
        { startPos: 60000, title: 'Named Chapter' },
      ]);

      expect(chapters).toHaveLength(2);
      // Empty string is stored as empty string by libgpod
      expect(chapters[0]!.title).toBe('');
      expect(chapters[1]!.title).toBe('Named Chapter');

      db.close();
    });
  });

  it(
    'can set chapter with startPos beyond track duration',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({
          title: 'Duration Test',
          mediaType: MediaType.Podcast,
          duration: 60000, // 1 minute
        });

        // Set chapter at 2 minutes (past the 1 minute duration)
        // libgpod doesn't validate this - it's up to the caller
        const chapters = db.setTrackChapters(track.id, [
          { startPos: 0, title: 'Start' },
          { startPos: 120000, title: 'Beyond Duration' },
        ]);

        expect(chapters).toHaveLength(2);
        expect(chapters[1]!.startPos).toBe(120000);

        db.close();
      });
    }
  );

  it('throws error on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'Closed DB Test',
        mediaType: MediaType.Podcast,
      });

      const trackId = track.id;

      db.close();

      // All chapter operations should throw on closed database
      expect(() => {
        db.getTrackChapters(trackId);
      }).toThrow(LibgpodError);

      expect(() => {
        db.setTrackChapters(trackId, [{ startPos: 0, title: 'Test' }]);
      }).toThrow(LibgpodError);

      expect(() => {
        db.addTrackChapter(trackId, 0, 'Test');
      }).toThrow(LibgpodError);

      expect(() => {
        db.clearTrackChapters(trackId);
      }).toThrow(LibgpodError);
    });
  });

  it(
    'chapters added out of order are stored as provided',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({
          title: 'Out of Order Test',
          mediaType: MediaType.Podcast,
          duration: 600000,
        });

        // Add chapters in reverse chronological order
        // libgpod stores chapters in the order they are added
        const chapters = db.setTrackChapters(track.id, [
          { startPos: 300000, title: 'Middle' },
          { startPos: 0, title: 'Start' },
          { startPos: 600000, title: 'End' },
        ]);

        expect(chapters).toHaveLength(3);
        // Chapters are stored in the order provided
        expect(chapters[0]!.startPos).toBe(300000);
        expect(chapters[0]!.title).toBe('Middle');
        expect(chapters[1]!.startPos).toBe(1); // 0 becomes 1
        expect(chapters[1]!.title).toBe('Start');
        expect(chapters[2]!.startPos).toBe(600000);
        expect(chapters[2]!.title).toBe('End');

        db.close();
      });
    }
  );

  it(
    'can add chapter with very large startPos',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({
          title: 'Large Time Test',
          mediaType: MediaType.Audiobook,
          duration: 86400000, // 24 hours
        });

        // Add a chapter at 12 hours
        const chapters = db.setTrackChapters(track.id, [
          { startPos: 0, title: 'Beginning' },
          { startPos: 43200000, title: 'Halfway' }, // 12 hours in ms
        ]);

        expect(chapters).toHaveLength(2);
        expect(chapters[1]!.startPos).toBe(43200000);
        expect(chapters[1]!.title).toBe('Halfway');

        db.close();
      });
    }
  );
});

describe('libgpod-node chapter data with media types', () => {
  it('works with podcast media type', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'My Podcast',
        artist: 'Podcast Host',
        mediaType: MediaType.Podcast,
        duration: 1800000, // 30 minutes
      });

      expect(track.mediaType).toBe(MediaType.Podcast);

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Welcome' },
        { startPos: 300000, title: 'News' },
        { startPos: 900000, title: 'Main Topic' },
        { startPos: 1500000, title: 'Wrap Up' },
      ]);

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toHaveLength(4);

      db.close();
    });
  });

  it('works with audiobook media type', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const track = db.addTrack({
        title: 'My Audiobook - Part 1',
        artist: 'Author Name',
        mediaType: MediaType.Audiobook,
        duration: 7200000, // 2 hours
      });

      expect(track.mediaType).toBe(MediaType.Audiobook);

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Prologue' },
        { startPos: 600000, title: 'Chapter 1: The Beginning' },
        { startPos: 2400000, title: 'Chapter 2: The Journey' },
        { startPos: 4800000, title: 'Chapter 3: The Discovery' },
      ]);

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toHaveLength(4);
      expect(chapters[1]!.title).toBe('Chapter 1: The Beginning');

      db.close();
    });
  });

  it('chapters work with audio type too', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Even regular audio tracks can have chapters (e.g., DJ mixes)
      const track = db.addTrack({
        title: 'DJ Mix',
        artist: 'Various',
        mediaType: MediaType.Audio,
        duration: 3600000, // 1 hour
      });

      db.setTrackChapters(track.id, [
        { startPos: 0, title: 'Track 1' },
        { startPos: 300000, title: 'Track 2' },
        { startPos: 600000, title: 'Track 3' },
      ]);

      const chapters = db.getTrackChapters(track.id);
      expect(chapters).toHaveLength(3);

      db.close();
    });
  });
});
