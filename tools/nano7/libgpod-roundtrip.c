/* Create, resave or delete one synthetic track with libgpod.
 * Usage: libgpod-roundtrip <temporary mountpoint> create|resave|delete */
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
        if (g_list_length(db->tracks) != 1)
            return 5;
        track = db->tracks->data;
        if (strcmp(track->title, "Synthetic track") != 0)
            return 6;
        if (strcmp(argv[2], "delete") == 0) {
            GList *item;
            for (item = db->playlists; item; item = item->next)
                itdb_playlist_remove_track(item->data, track);
            itdb_track_remove(track);
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
