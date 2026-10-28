/* Create, resave or delete one synthetic track with libgpod, add a second
 * one, a movie (add), give the first a 1 MiB comment (grow) or the second
 * playlist the master playlist's id (clash), set the first one's rating to 60
 * and bookmark to 3000 ms (rate) or clear its play data (clear).
 * Usage: libgpod-roundtrip <temporary mountpoint>
 *        create|resave|delete|add|grow|clash|rate|clear */
#include <gpod/itdb.h>
#include <string.h>

int main(int argc, char **argv)
{
    Itdb_iTunesDB *db;
    Itdb_Playlist *master;
    Itdb_Track *track;
    GError *error = NULL;
    gboolean saved;

    if (argc != 3)
        return 2;
    if (strcmp(argv[2], "create") == 0) {
        db = itdb_new();
        itdb_set_mountpoint(db, argv[1]);
        master = itdb_playlist_new("Nano test", FALSE);
        itdb_playlist_set_mpl(master);
        itdb_playlist_add(db, master, -1);
        track = itdb_track_new();
        track->title = g_strdup("Synthetic track");
        track->artist = g_strdup("Test artist");
        track->album = g_strdup("Test album");
        track->filetype = g_strdup("MPEG audio file");
        track->ipod_path = g_strdup(":iPod_Control:Music:F00:TEST.mp3");
        track->mediatype = ITDB_MEDIATYPE_AUDIO;
        track->tracklen = 2000;
        track->samplerate = 44100;
        track->bitrate = 128;
        track->size = 32000;
        track->transferred = TRUE;
        track->time_modified = 1784116800; /* 2026-07-15 12:00 UTC */
        track->time_added = 1768478400;    /* 2026-01-15 12:00 UTC */
        itdb_track_add(db, track, -1);
        itdb_playlist_add_track(master, track, -1);
        master = itdb_playlist_new("Test playlist", FALSE);
        itdb_playlist_add(db, master, -1);
        itdb_playlist_add_track(master, track, -1);
    } else {
        db = itdb_parse(argv[1], &error);
        if (!db) {
            g_printerr("parse: %s\n", error ? error->message : "unknown error");
            return 4;
        }
        GList *item;
        for (item = db->tracks; item; item = item->next)
            if (strcmp(((Itdb_Track *)item->data)->title, "Synthetic track") == 0)
                break;
        if (!item)
            return 5;
        track = item->data;
        if (strcmp(argv[2], "delete") == 0) {
            for (item = db->playlists; item; item = item->next)
                itdb_playlist_remove_track(item->data, track);
            itdb_track_remove(track);
        } else if (strcmp(argv[2], "add") == 0) {
            track = itdb_track_new();
            track->title = g_strdup("Second track");
            track->filetype = g_strdup("MPEG-4 video file");
            track->ipod_path = g_strdup(":iPod_Control:Music:F00:TEST2.m4v");
            track->mediatype = ITDB_MEDIATYPE_MOVIE;
            track->size = 32000;
            track->transferred = TRUE;
            itdb_track_add(db, track, -1);
            itdb_playlist_add_track(itdb_playlist_mpl(db), track, -1);
        } else if (strcmp(argv[2], "grow") == 0) {
            g_free(track->comment);
            track->comment = g_strnfill(1 << 20, 'x');
        } else if (strcmp(argv[2], "clash") == 0) {
            ((Itdb_Playlist *)g_list_last(db->playlists)->data)->id = itdb_playlist_mpl(db)->id;
        } else if (strcmp(argv[2], "rate") == 0) {
            track->rating = 60;
            track->bookmark_time = 3000;
        } else if (strcmp(argv[2], "clear") == 0) {
            track->playcount = track->skipcount = 0;
            track->recent_playcount = track->recent_skipcount = 0;
            track->time_played = track->last_skipped = 0;
            track->rating = 0;
            track->bookmark_time = 0;
        } else if (strcmp(argv[2], "resave") != 0) {
            return 2;
        }
    }
    saved = itdb_write(db, &error);
    if (!saved)
        g_printerr("write: %s\n", error ? error->message : "unknown error");
    g_clear_error(&error);
    itdb_free(db);
    return saved ? 0 : 1;
}
