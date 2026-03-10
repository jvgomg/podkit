/**
 * Integration tests for libgpod-node smart playlist functionality.
 *
 * These tests cover: smart playlist creation, rule management,
 * preferences, and rule evaluation.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect } from 'bun:test';

import { withTestIpod, Database, LibgpodError } from './helpers/test-setup';

import { SPLMatch, SPLField, SPLAction, SPLLimitType, SPLLimitSort } from '../types';

// ============================================================================
// Smart Playlist CRUD tests
// ============================================================================

describe('libgpod-node smart playlist operations', () => {
  it('can create a smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'My Smart Playlist',
      });

      expect(playlist).toBeDefined();
      expect(playlist.name).toBe('My Smart Playlist');
      expect(playlist.isSmart).toBe(true);
      expect(playlist.isMaster).toBe(false);

      db.close();
    });
  });

  it('smart playlist has default preferences', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Default Prefs Playlist',
      });

      expect(playlist.preferences).toBeDefined();
      expect(playlist.preferences.liveUpdate).toBe(true);
      expect(playlist.preferences.checkRules).toBe(true);
      expect(playlist.preferences.checkLimits).toBe(false);

      db.close();
    });
  });

  it('can create smart playlist with rules', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Rock Music',
        match: SPLMatch.And,
        rules: [
          {
            field: SPLField.Genre,
            action: SPLAction.Contains,
            string: 'Rock',
          },
        ],
      });

      expect(playlist.rules).toHaveLength(1);
      expect(playlist.rules[0]!.field).toBe(SPLField.Genre);
      expect(playlist.rules[0]!.action).toBe(SPLAction.Contains);
      expect(playlist.rules[0]!.string).toBe('Rock');
      expect(playlist.match).toBe(SPLMatch.And);

      db.close();
    });
  });

  it('can create smart playlist with multiple rules', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Rock by Beatles',
        match: SPLMatch.And,
        rules: [
          {
            field: SPLField.Genre,
            action: SPLAction.Contains,
            string: 'Rock',
          },
          {
            field: SPLField.Artist,
            action: SPLAction.Contains,
            string: 'Beatles',
          },
        ],
      });

      expect(playlist.rules).toHaveLength(2);
      expect(playlist.rules[0]!.field).toBe(SPLField.Genre);
      expect(playlist.rules[1]!.field).toBe(SPLField.Artist);

      db.close();
    });
  });

  it('can create smart playlist with OR match', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Rock or Jazz',
        match: SPLMatch.Or,
        rules: [
          {
            field: SPLField.Genre,
            action: SPLAction.Contains,
            string: 'Rock',
          },
          {
            field: SPLField.Genre,
            action: SPLAction.Contains,
            string: 'Jazz',
          },
        ],
      });

      expect(playlist.match).toBe(SPLMatch.Or);
      expect(playlist.rules).toHaveLength(2);

      db.close();
    });
  });

  it('can create smart playlist with custom preferences', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Limited Playlist',
        preferences: {
          liveUpdate: true,
          checkRules: true,
          checkLimits: true,
          limitType: SPLLimitType.Songs,
          limitValue: 50,
          limitSort: SPLLimitSort.Random,
        },
      });

      expect(playlist.preferences.checkLimits).toBe(true);
      expect(playlist.preferences.limitType).toBe(SPLLimitType.Songs);
      expect(playlist.preferences.limitValue).toBe(50);
      expect(playlist.preferences.limitSort).toBe(SPLLimitSort.Random);

      db.close();
    });
  });

  it('can save and retrieve smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const created = db.createSmartPlaylist({
        name: 'Persisted Smart Playlist',
        rules: [
          {
            field: SPLField.Artist,
            action: SPLAction.Contains,
            string: 'Test Artist',
          },
        ],
      });

      db.saveSync();
      db.close();

      // Re-open and verify
      const db2 = Database.openSync(ipod.path);
      const retrieved = db2.getPlaylistById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Persisted Smart Playlist');
      expect(retrieved!.isSmart).toBe(true);

      // Get rules
      const rules = db2.getSmartPlaylistRules(created.id);
      expect(rules).toHaveLength(1);
      expect(rules[0]!.field).toBe(SPLField.Artist);
      expect(rules[0]!.string).toBe('Test Artist');

      db2.close();
    });
  });

  it('can add rule to existing smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Expandable Playlist',
        rules: [],
      });

      expect(playlist.rules).toHaveLength(0);

      // Add a rule
      const updated = db.addSmartPlaylistRule(playlist.id, {
        field: SPLField.Year,
        action: SPLAction.IsGreaterThan,
        fromValue: 2000,
      });

      expect(updated.rules).toHaveLength(1);
      expect(updated.rules[0]!.field).toBe(SPLField.Year);
      expect(updated.rules[0]!.fromValue).toBe(2000);

      db.close();
    });
  });

  it('can remove rule from smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Shrinkable Playlist',
        rules: [
          { field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' },
          { field: SPLField.Artist, action: SPLAction.Contains, string: 'Beatles' },
        ],
      });

      expect(playlist.rules).toHaveLength(2);

      // Remove the first rule
      const updated = db.removeSmartPlaylistRule(playlist.id, 0);

      expect(updated.rules).toHaveLength(1);
      expect(updated.rules[0]!.field).toBe(SPLField.Artist);

      db.close();
    });
  });

  it('can clear all rules from smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Clearable Playlist',
        rules: [
          { field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' },
          { field: SPLField.Artist, action: SPLAction.Contains, string: 'Beatles' },
          { field: SPLField.Year, action: SPLAction.IsGreaterThan, fromValue: 2000 },
        ],
      });

      expect(playlist.rules).toHaveLength(3);

      // Clear all rules
      const updated = db.clearSmartPlaylistRules(playlist.id);

      expect(updated.rules).toHaveLength(0);

      db.close();
    });
  });

  it('can update smart playlist preferences', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Updatable Playlist',
      });

      // Initially checkLimits should be false
      expect(playlist.preferences.checkLimits).toBe(false);

      // Update preferences
      const updated = db.setSmartPlaylistPreferences(playlist.id, {
        checkLimits: true,
        limitType: SPLLimitType.Minutes,
        limitValue: 60,
      });

      expect(updated.preferences.checkLimits).toBe(true);
      expect(updated.preferences.limitType).toBe(SPLLimitType.Minutes);
      expect(updated.preferences.limitValue).toBe(60);

      db.close();
    });
  });

  it('can get smart playlist preferences', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Prefs Test Playlist',
        preferences: {
          checkLimits: true,
          limitType: SPLLimitType.GB,
          limitValue: 2,
        },
      });

      const prefs = db.getSmartPlaylistPreferences(playlist.id);

      expect(prefs.checkLimits).toBe(true);
      expect(prefs.limitType).toBe(SPLLimitType.GB);
      expect(prefs.limitValue).toBe(2);

      db.close();
    });
  });

  it('getSmartPlaylists returns only smart playlists', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Create regular playlist
      db.createPlaylist('Regular Playlist');

      // Create smart playlists
      db.createSmartPlaylist({ name: 'Smart 1' });
      db.createSmartPlaylist({ name: 'Smart 2' });

      const smartPlaylists = db.getSmartPlaylists();

      expect(smartPlaylists).toHaveLength(2);
      expect(smartPlaylists.every((p) => p.isSmart)).toBe(true);
      expect(smartPlaylists.map((p) => p.name)).toContain('Smart 1');
      expect(smartPlaylists.map((p) => p.name)).toContain('Smart 2');

      db.close();
    });
  });

  it('throws error when getting rules of non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.getSmartPlaylistRules(regularPlaylist.id);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws error when adding rule to non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.addSmartPlaylistRule(regularPlaylist.id, {
          field: SPLField.Genre,
          action: SPLAction.Contains,
          string: 'Rock',
        });
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws error for invalid rule index', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Index Test',
        rules: [{ field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }],
      });

      expect(() => {
        db.removeSmartPlaylistRule(playlist.id, 999);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('can delete smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'To Be Deleted',
      });

      const playlistId = playlist.id;

      // Delete it (using removePlaylist - same as regular playlists)
      db.removePlaylist(playlistId);

      // Verify it's gone
      const found = db.getPlaylistById(playlistId);
      expect(found).toBeNull();

      db.close();
    });
  });
});

// ============================================================================
// Smart Playlist Evaluation tests
// ============================================================================

describe('libgpod-node smart playlist evaluation', () => {
  it('evaluates empty rules to return all tracks', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add some tracks
      db.addTrack({ title: 'Track 1', artist: 'Artist A', genre: 'Rock' });
      db.addTrack({ title: 'Track 2', artist: 'Artist B', genre: 'Jazz' });

      // Create smart playlist with no rules
      const playlist = db.createSmartPlaylist({
        name: 'All Tracks',
        rules: [],
      });

      const matches = db.evaluateSmartPlaylist(playlist.id);

      // With no rules, should match all tracks
      expect(matches).toHaveLength(2);

      db.close();
    });
  });

  it('evaluates genre contains rule', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add tracks with different genres
      db.addTrack({ title: 'Rock Song', artist: 'Rocker', genre: 'Rock' });
      db.addTrack({ title: 'Jazz Song', artist: 'Jazzer', genre: 'Jazz' });
      db.addTrack({ title: 'Alt Rock Song', artist: 'Alt', genre: 'Alternative Rock' });

      // Save and re-open to ensure tracks are properly indexed
      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);

      // Create smart playlist for rock
      const playlist = db2.createSmartPlaylist({
        name: 'Rock Only',
        rules: [{ field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }],
      });

      const matchHandles = db2.evaluateSmartPlaylist(playlist.id);

      // Should match "Rock" and "Alternative Rock"
      expect(matchHandles).toHaveLength(2);
      const titles = matchHandles.map((h) => db2.getTrack(h).title);
      expect(titles).toContain('Rock Song');
      expect(titles).toContain('Alt Rock Song');
      expect(titles).not.toContain('Jazz Song');

      db2.close();
    });
  });

  it('evaluates artist contains rule', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      db.addTrack({ title: 'Song 1', artist: 'The Beatles', genre: 'Rock' });
      db.addTrack({ title: 'Song 2', artist: 'Beatles Tribute', genre: 'Rock' });
      db.addTrack({ title: 'Song 3', artist: 'Rolling Stones', genre: 'Rock' });

      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);

      const playlist = db2.createSmartPlaylist({
        name: 'Beatles',
        rules: [{ field: SPLField.Artist, action: SPLAction.Contains, string: 'Beatles' }],
      });

      const matchHandles = db2.evaluateSmartPlaylist(playlist.id);

      expect(matchHandles).toHaveLength(2);
      const artists = matchHandles.map((h) => db2.getTrack(h).artist);
      expect(artists).toContain('The Beatles');
      expect(artists).toContain('Beatles Tribute');

      db2.close();
    });
  });

  it('evaluates AND rules correctly', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      db.addTrack({ title: 'Rock Beatles', artist: 'Beatles', genre: 'Rock' });
      db.addTrack({ title: 'Jazz Beatles', artist: 'Beatles', genre: 'Jazz' });
      db.addTrack({ title: 'Rock Stones', artist: 'Rolling Stones', genre: 'Rock' });

      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);

      const playlist = db2.createSmartPlaylist({
        name: 'Rock by Beatles',
        match: SPLMatch.And,
        rules: [
          { field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' },
          { field: SPLField.Artist, action: SPLAction.Contains, string: 'Beatles' },
        ],
      });

      const matchHandles = db2.evaluateSmartPlaylist(playlist.id);

      // Only "Rock Beatles" matches both rules
      expect(matchHandles).toHaveLength(1);
      expect(db2.getTrack(matchHandles[0]!).title).toBe('Rock Beatles');

      db2.close();
    });
  });

  it('evaluates OR rules correctly', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      db.addTrack({ title: 'Rock Song', artist: 'Rocker', genre: 'Rock' });
      db.addTrack({ title: 'Jazz Song', artist: 'Jazzer', genre: 'Jazz' });
      db.addTrack({ title: 'Pop Song', artist: 'Popper', genre: 'Pop' });

      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);

      const playlist = db2.createSmartPlaylist({
        name: 'Rock or Jazz',
        match: SPLMatch.Or,
        rules: [
          { field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' },
          { field: SPLField.Genre, action: SPLAction.Contains, string: 'Jazz' },
        ],
      });

      const matchHandles = db2.evaluateSmartPlaylist(playlist.id);

      // Should match Rock and Jazz, not Pop
      expect(matchHandles).toHaveLength(2);
      const genres = matchHandles.map((h) => db2.getTrack(h).genre);
      expect(genres).toContain('Rock');
      expect(genres).toContain('Jazz');
      expect(genres).not.toContain('Pop');

      db2.close();
    });
  });

  it('respects checkRules preference', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      db.addTrack({ title: 'Rock Song', artist: 'Rocker', genre: 'Rock' });
      db.addTrack({ title: 'Jazz Song', artist: 'Jazzer', genre: 'Jazz' });

      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);

      // Create playlist with checkRules = false
      const playlist = db2.createSmartPlaylist({
        name: 'Unchecked Rules',
        rules: [{ field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }],
        preferences: {
          checkRules: false,
        },
      });

      const matches = db2.evaluateSmartPlaylist(playlist.id);

      // When checkRules is false, should return empty array
      expect(matches).toHaveLength(0);

      db2.close();
    });
  });

  it('throws error when evaluating non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.evaluateSmartPlaylist(regularPlaylist.id);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws error when evaluating non-existent playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      expect(() => {
        db.evaluateSmartPlaylist(BigInt(999999999));
      }).toThrow(LibgpodError);

      db.close();
    });
  });
});

// ============================================================================
// Smart Playlist Rule Types tests
// ============================================================================

describe('libgpod-node smart playlist rule types', () => {
  it('can create rule with numeric comparison', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'High Rated',
        rules: [
          {
            field: SPLField.Rating,
            action: SPLAction.IsGreaterThan,
            fromValue: 80, // 4 stars
          },
        ],
      });

      expect(playlist.rules).toHaveLength(1);
      expect(playlist.rules[0]!.field).toBe(SPLField.Rating);
      expect(playlist.rules[0]!.action).toBe(SPLAction.IsGreaterThan);
      expect(playlist.rules[0]!.fromValue).toBe(80);

      db.close();
    });
  });

  it('can create rule with year comparison', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: '2000s Music',
        rules: [
          {
            field: SPLField.Year,
            action: SPLAction.IsGreaterThan,
            fromValue: 1999,
          },
          {
            field: SPLField.Year,
            action: SPLAction.IsLessThan,
            fromValue: 2010,
          },
        ],
      });

      expect(playlist.rules).toHaveLength(2);

      db.close();
    });
  });

  it('can create rule with play count', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Most Played',
        rules: [
          {
            field: SPLField.PlayCount,
            action: SPLAction.IsGreaterThan,
            fromValue: 10,
          },
        ],
      });

      expect(playlist.rules[0]!.field).toBe(SPLField.PlayCount);

      db.close();
    });
  });

  it('can create rule with negated action', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Not Rock',
        rules: [
          {
            field: SPLField.Genre,
            action: SPLAction.DoesNotContain,
            string: 'Rock',
          },
        ],
      });

      expect(playlist.rules[0]!.action).toBe(SPLAction.DoesNotContain);

      db.close();
    });
  });

  it('can create rule with starts with action', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'The Bands',
        rules: [
          {
            field: SPLField.Artist,
            action: SPLAction.StartsWith,
            string: 'The ',
          },
        ],
      });

      expect(playlist.rules[0]!.action).toBe(SPLAction.StartsWith);

      db.close();
    });
  });

  it('can create rule with album field', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Greatest Hits',
        rules: [
          {
            field: SPLField.Album,
            action: SPLAction.Contains,
            string: 'Greatest Hits',
          },
        ],
      });

      expect(playlist.rules[0]!.field).toBe(SPLField.Album);

      db.close();
    });
  });

  it('can create rule with range comparison', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: '2000s Music',
        rules: [
          {
            field: SPLField.Year,
            action: SPLAction.IsInTheRange,
            fromValue: 2000,
            toValue: 2009,
          },
        ],
      });

      expect(playlist.rules[0]!.field).toBe(SPLField.Year);
      expect(playlist.rules[0]!.action).toBe(SPLAction.IsInTheRange);
      expect(playlist.rules[0]!.fromValue).toBe(2000);
      expect(playlist.rules[0]!.toValue).toBe(2009);

      db.close();
    });
  });

  it('can create rule with exact string match', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Exact Genre',
        rules: [
          {
            field: SPLField.Genre,
            action: SPLAction.IsString,
            string: 'Rock',
          },
        ],
      });

      expect(playlist.rules[0]!.action).toBe(SPLAction.IsString);
      expect(playlist.rules[0]!.string).toBe('Rock');

      db.close();
    });
  });

  it('can create rule with bitrate field', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'High Quality',
        rules: [
          {
            field: SPLField.Bitrate,
            action: SPLAction.IsGreaterThan,
            fromValue: 256, // kbps
          },
        ],
      });

      expect(playlist.rules[0]!.field).toBe(SPLField.Bitrate);
      expect(playlist.rules[0]!.fromValue).toBe(256);

      db.close();
    });
  });

  it('can create rule with skip count field', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Least Skipped',
        rules: [
          {
            field: SPLField.SkipCount,
            action: SPLAction.IsLessThan,
            fromValue: 5,
          },
        ],
      });

      expect(playlist.rules[0]!.field).toBe(SPLField.SkipCount);
      expect(playlist.rules[0]!.action).toBe(SPLAction.IsLessThan);

      db.close();
    });
  });

  it('can set matchCheckedOnly preference', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlist = db.createSmartPlaylist({
        name: 'Checked Only',
        preferences: {
          matchCheckedOnly: true,
        },
      });

      expect(playlist.preferences.matchCheckedOnly).toBe(true);

      db.close();
    });
  });
});

// ============================================================================
// Error handling tests
// ============================================================================

describe('libgpod-node smart playlist error handling', () => {
  it('throws error when creating smart playlist on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.close();

      expect(() => {
        db.createSmartPlaylist({ name: 'Test' });
      }).toThrow(LibgpodError);
    });
  });

  it('throws error when getting rules on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const playlist = db.createSmartPlaylist({ name: 'Test' });
      db.close();

      expect(() => {
        db.getSmartPlaylistRules(playlist.id);
      }).toThrow(LibgpodError);
    });
  });

  it('throws error when adding rule on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const playlist = db.createSmartPlaylist({ name: 'Test' });
      db.close();

      expect(() => {
        db.addSmartPlaylistRule(playlist.id, {
          field: SPLField.Genre,
          action: SPLAction.Contains,
          string: 'Rock',
        });
      }).toThrow(LibgpodError);
    });
  });

  it('throws error when evaluating on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const playlist = db.createSmartPlaylist({ name: 'Test' });
      db.close();

      expect(() => {
        db.evaluateSmartPlaylist(playlist.id);
      }).toThrow(LibgpodError);
    });
  });

  it('throws error when setting preferences on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const playlist = db.createSmartPlaylist({ name: 'Test' });
      db.close();

      expect(() => {
        db.setSmartPlaylistPreferences(playlist.id, { liveUpdate: false });
      }).toThrow(LibgpodError);
    });
  });

  it('throws error when getting preferences for non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.getSmartPlaylistPreferences(regularPlaylist.id);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws error when setting preferences for non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.setSmartPlaylistPreferences(regularPlaylist.id, {
          liveUpdate: true,
        });
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws error when clearing rules for non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.clearSmartPlaylistRules(regularPlaylist.id);
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws error when removing rule for non-smart playlist', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      const regularPlaylist = db.createPlaylist('Regular');

      expect(() => {
        db.removeSmartPlaylistRule(regularPlaylist.id, 0);
      }).toThrow(LibgpodError);

      db.close();
    });
  });
});
