/**
 * gpod-tool - Command-line utility for libgpod operations
 *
 * A standalone tool for creating and managing iPod database structures
 * for testing and development purposes.
 *
 * Commands:
 *   init       Create a new iPod structure
 *   info       Display database information
 *   tracks     List all tracks
 *   add-track  Add a track entry (metadata only)
 *   verify     Verify database can be parsed
 *
 * Usage:
 *   gpod-tool <command> <path> [options]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <getopt.h>
#include <gpod/itdb.h>
#include <glib.h>

#define VERSION "0.1.0"

/* Output format */
static bool json_output = false;

/* ============================================================================
 * JSON Helpers
 * ============================================================================ */

static void json_escape_string(const char *str, char *buf, size_t bufsize) {
    if (!str) {
        snprintf(buf, bufsize, "null");
        return;
    }

    size_t j = 0;
    buf[j++] = '"';

    for (size_t i = 0; str[i] && j < bufsize - 2; i++) {
        char c = str[i];
        switch (c) {
            case '"':  if (j < bufsize - 3) { buf[j++] = '\\'; buf[j++] = '"'; } break;
            case '\\': if (j < bufsize - 3) { buf[j++] = '\\'; buf[j++] = '\\'; } break;
            case '\n': if (j < bufsize - 3) { buf[j++] = '\\'; buf[j++] = 'n'; } break;
            case '\r': if (j < bufsize - 3) { buf[j++] = '\\'; buf[j++] = 'r'; } break;
            case '\t': if (j < bufsize - 3) { buf[j++] = '\\'; buf[j++] = 't'; } break;
            default:   buf[j++] = c; break;
        }
    }

    buf[j++] = '"';
    buf[j] = '\0';
}

static void print_json_string(const char *key, const char *value, bool comma) {
    char escaped[1024];
    json_escape_string(value, escaped, sizeof(escaped));
    printf("  \"%s\": %s%s\n", key, escaped, comma ? "," : "");
}

static void print_json_int(const char *key, int value, bool comma) {
    printf("  \"%s\": %d%s\n", key, value, comma ? "," : "");
}

static void print_json_bool(const char *key, bool value, bool comma) {
    printf("  \"%s\": %s%s\n", key, value ? "true" : "false", comma ? "," : "");
}

/* ============================================================================
 * Helpers: firewire-id support for init
 * ============================================================================ */

static bool is_valid_firewire_id(const char *id) {
    if (!id) return false;
    size_t len = strlen(id);
    if (len != 40) return false;
    for (size_t i = 0; i < 40; i++) {
        char c = id[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
            return false;
    }
    return true;
}

static bool is_hash72_model(Itdb_Device *device) {
    const Itdb_IpodInfo *info = itdb_device_get_ipod_info(device);
    if (!info) return false;
    return (info->ipod_generation == ITDB_IPOD_GENERATION_NANO_5);
}

static int write_synthetic_hash_info(const char *path, const char *firewire_id) {
    /* Build file path */
    char hash_path[4096];
    snprintf(hash_path, sizeof(hash_path), "%s/iPod_Control/Device/HashInfo", path);

    /* 54-byte HashInfo structure */
    unsigned char data[54];
    memset(data, 0, sizeof(data));

    /* Header: "HASHv0" */
    memcpy(data, "HASHv0", 6);

    /* UUID: decode hex firewire_id into 20 bytes */
    for (int i = 0; i < 20; i++) {
        unsigned int byte;
        sscanf(&firewire_id[i * 2], "%02x", &byte);
        data[6 + i] = (unsigned char)byte;
    }

    /* rndpart: 12 deterministic bytes */
    unsigned char rndpart[12] = { 0xDE, 0xCA, 0xDE, 0x00, 0xDE, 0xCA, 0xDE, 0x00, 0xDE, 0xCA, 0xDE, 0x00 };
    memcpy(data + 26, rndpart, 12);

    /* iv: 16 deterministic bytes */
    for (int i = 0; i < 16; i++) {
        data[38 + i] = (unsigned char)i;
    }

    /* Ensure directory exists */
    char device_dir[4096];
    snprintf(device_dir, sizeof(device_dir), "%s/iPod_Control/Device", path);
    if (g_mkdir_with_parents(device_dir, 0755) != 0) {
        return -1;
    }

    /* Write file */
    if (!g_file_set_contents(hash_path, (const gchar *)data, sizeof(data), NULL)) {
        return -1;
    }

    return 0;
}

/* ============================================================================
 * Command: init
 * ============================================================================ */

static void print_init_usage(void) {
    fprintf(stderr, "Usage: gpod-tool init <path> [options]\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Create a new iPod database structure.\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -m, --model <model>      Model number (default: MA147 - iPod Video 60GB)\n");
    fprintf(stderr, "  -n, --name <name>        iPod name (default: Test iPod)\n");
    fprintf(stderr, "  -f, --firewire-id <hex>  FirewireGuid for checksum models (40 hex chars)\n");
    fprintf(stderr, "  -j, --json               Output result as JSON\n");
    fprintf(stderr, "  -h, --help               Show this help\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Common model numbers:\n");
    fprintf(stderr, "  MA147  iPod Video 60GB (5th gen)\n");
    fprintf(stderr, "  MB565  iPod Classic 120GB (6th gen)\n");
    fprintf(stderr, "  MA477  iPod Nano 2GB (2nd gen)\n");
}

static int cmd_init(int argc, char *argv[]) {
    const char *model = "MA147";
    const char *name = "Test iPod";
    const char *path = NULL;
    const char *firewire_id = NULL;

    static struct option long_options[] = {
        {"model",       required_argument, 0, 'm'},
        {"name",        required_argument, 0, 'n'},
        {"firewire-id", required_argument, 0, 'f'},
        {"json",        no_argument,       0, 'j'},
        {"help",        no_argument,       0, 'h'},
        {0, 0, 0, 0}
    };

    int opt;
    optind = 1;  /* Reset getopt */
    while ((opt = getopt_long(argc, argv, "m:n:f:jh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'm': model = optarg; break;
            case 'n': name = optarg; break;
            case 'f': firewire_id = optarg; break;
            case 'j': json_output = true; break;
            case 'h': print_init_usage(); return 0;
            default:  print_init_usage(); return 1;
        }
    }

    if (optind >= argc) {
        fprintf(stderr, "Error: path required\n\n");
        print_init_usage();
        return 1;
    }

    path = argv[optind];

    /* Create directory if needed */
    if (g_mkdir_with_parents(path, 0755) != 0) {
        if (json_output) {
            printf("{\n");
            print_json_bool("success", false, true);
            print_json_string("error", "Failed to create directory", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: Failed to create directory: %s\n", path);
        }
        return 1;
    }

    if (firewire_id) {
        /* Validate firewire ID */
        if (!is_valid_firewire_id(firewire_id)) {
            if (json_output) {
                printf("{\n");
                print_json_bool("success", false, true);
                print_json_string("error", "firewire-id must be exactly 40 hex characters", false);
                printf("}\n");
            } else {
                fprintf(stderr, "Error: firewire-id must be exactly 40 hex characters\n");
            }
            return 1;
        }

        /* Pass 1: itdb_init_ipod() - creates directory structure + SysInfo, may fail at write */
        GError *init_error = NULL;
        itdb_init_ipod(path, model, name, &init_error);
        /* Ignore error - it's expected for checksum models */
        if (init_error) g_error_free(init_error);

        /* Pass 2: Create fresh database, read SysInfo from disk */
        Itdb_iTunesDB *itdb = itdb_new();
        itdb_set_mountpoint(itdb, path);  /* This reads ModelNumStr from SysInfo */

        /* Set FirewireGuid */
        itdb_device_set_sysinfo(itdb->device, "FirewireGuid", firewire_id);

        /* For hash72 models (Nano 5th gen), write synthetic HashInfo */
        if (is_hash72_model(itdb->device)) {
            if (write_synthetic_hash_info(path, firewire_id) != 0) {
                if (json_output) {
                    printf("{\n");
                    print_json_bool("success", false, true);
                    print_json_string("error", "Failed to write HashInfo file", false);
                    printf("}\n");
                } else {
                    fprintf(stderr, "Error: Failed to write HashInfo file\n");
                }
                itdb_free(itdb);
                return 1;
            }
        }

        /* Create master playlist */
        Itdb_Playlist *mpl = itdb_playlist_new(name, FALSE);
        itdb_playlist_set_mpl(mpl);
        itdb_playlist_add(itdb, mpl, -1);

        /* Write database */
        GError *write_error = NULL;
        if (!itdb_write(itdb, &write_error)) {
            if (json_output) {
                printf("{\n");
                print_json_bool("success", false, true);
                print_json_string("error", write_error ? write_error->message : "Failed to write database", false);
                printf("}\n");
            } else {
                fprintf(stderr, "Error: %s\n", write_error ? write_error->message : "Failed to write database");
            }
            if (write_error) g_error_free(write_error);
            itdb_free(itdb);
            return 1;
        }

        itdb_free(itdb);
    } else {
        /* Original flow - no firewire-id */
        GError *error = NULL;
        gboolean success = itdb_init_ipod(path, model, name, &error);

        if (!success) {
            if (json_output) {
                printf("{\n");
                print_json_bool("success", false, true);
                print_json_string("error", error ? error->message : "Unknown error", false);
                printf("}\n");
            } else {
                fprintf(stderr, "Error: %s\n", error ? error->message : "Unknown error");
            }
            if (error) g_error_free(error);
            return 1;
        }
    }

    if (json_output) {
        printf("{\n");
        print_json_bool("success", true, true);
        print_json_string("path", path, true);
        if (firewire_id) {
            print_json_string("firewire_id", firewire_id, true);
        }
        print_json_string("model", model, true);
        print_json_string("name", name, false);
        printf("}\n");
    } else {
        printf("iPod initialized successfully\n");
        printf("  Path:  %s\n", path);
        printf("  Model: %s\n", model);
        printf("  Name:  %s\n", name);
    }

    return 0;
}

/* ============================================================================
 * Command: info
 * ============================================================================ */

static void print_info_usage(void) {
    fprintf(stderr, "Usage: gpod-tool info <path> [options]\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Display information about an iPod database.\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -j, --json   Output as JSON\n");
    fprintf(stderr, "  -h, --help   Show this help\n");
}

static int cmd_info(int argc, char *argv[]) {
    const char *path = NULL;

    static struct option long_options[] = {
        {"json", no_argument, 0, 'j'},
        {"help", no_argument, 0, 'h'},
        {0, 0, 0, 0}
    };

    int opt;
    optind = 1;
    while ((opt = getopt_long(argc, argv, "jh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'j': json_output = true; break;
            case 'h': print_info_usage(); return 0;
            default:  print_info_usage(); return 1;
        }
    }

    if (optind >= argc) {
        fprintf(stderr, "Error: path required\n\n");
        print_info_usage();
        return 1;
    }

    path = argv[optind];

    GError *error = NULL;
    Itdb_iTunesDB *itdb = itdb_parse(path, &error);

    if (!itdb) {
        if (json_output) {
            printf("{\n");
            print_json_bool("success", false, true);
            print_json_string("error", error ? error->message : "Failed to parse database", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: %s\n", error ? error->message : "Failed to parse database");
        }
        if (error) g_error_free(error);
        return 1;
    }

    int track_count = itdb_tracks_number(itdb);
    int playlist_count = itdb_playlists_number(itdb);

    const Itdb_IpodInfo *ipod_info = itdb_device_get_ipod_info(itdb->device);
    const char *model_number = ipod_info ? ipod_info->model_number : NULL;
    const char *model_name = NULL;

    if (ipod_info) {
        /* Get model name from generation/capacity */
        switch (ipod_info->ipod_generation) {
            case ITDB_IPOD_GENERATION_VIDEO_1:
            case ITDB_IPOD_GENERATION_VIDEO_2:
                model_name = "iPod Video";
                break;
            case ITDB_IPOD_GENERATION_CLASSIC_1:
            case ITDB_IPOD_GENERATION_CLASSIC_2:
            case ITDB_IPOD_GENERATION_CLASSIC_3:
                model_name = "iPod Classic";
                break;
            case ITDB_IPOD_GENERATION_NANO_1:
            case ITDB_IPOD_GENERATION_NANO_2:
            case ITDB_IPOD_GENERATION_NANO_3:
            case ITDB_IPOD_GENERATION_NANO_4:
            case ITDB_IPOD_GENERATION_NANO_5:
                model_name = "iPod Nano";
                break;
            default:
                model_name = "Unknown";
                break;
        }
    }

    gboolean supports_artwork = itdb_device_supports_artwork(itdb->device);
    gboolean supports_video = itdb_device_supports_video(itdb->device);

    if (json_output) {
        char model_num_escaped[256];
        json_escape_string(model_number, model_num_escaped, sizeof(model_num_escaped));

        printf("{\n");
        print_json_bool("success", true, true);
        print_json_string("path", path, true);
        printf("  \"device\": {\n");
        printf("    \"model_number\": %s,\n", model_num_escaped);
        printf("    \"model_name\": \"%s\",\n", model_name ? model_name : "Unknown");
        printf("    \"supports_artwork\": %s,\n", supports_artwork ? "true" : "false");
        printf("    \"supports_video\": %s\n", supports_video ? "true" : "false");
        printf("  },\n");
        print_json_int("track_count", track_count, true);
        print_json_int("playlist_count", playlist_count, false);
        printf("}\n");
    } else {
        printf("iPod Database Info\n");
        printf("  Path:      %s\n", path);
        printf("  Model:     %s (%s)\n",
               model_number ? model_number : "Unknown",
               model_name ? model_name : "Unknown");
        printf("  Tracks:    %d\n", track_count);
        printf("  Playlists: %d\n", playlist_count);
        printf("  Artwork:   %s\n", supports_artwork ? "supported" : "not supported");
        printf("  Video:     %s\n", supports_video ? "supported" : "not supported");
    }

    itdb_free(itdb);
    return 0;
}

/* ============================================================================
 * Command: tracks
 * ============================================================================ */

static void print_tracks_usage(void) {
    fprintf(stderr, "Usage: gpod-tool tracks <path> [options]\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "List all tracks in the database.\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -j, --json   Output as JSON\n");
    fprintf(stderr, "  -h, --help   Show this help\n");
}

static int cmd_tracks(int argc, char *argv[]) {
    const char *path = NULL;

    static struct option long_options[] = {
        {"json", no_argument, 0, 'j'},
        {"help", no_argument, 0, 'h'},
        {0, 0, 0, 0}
    };

    int opt;
    optind = 1;
    while ((opt = getopt_long(argc, argv, "jh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'j': json_output = true; break;
            case 'h': print_tracks_usage(); return 0;
            default:  print_tracks_usage(); return 1;
        }
    }

    if (optind >= argc) {
        fprintf(stderr, "Error: path required\n\n");
        print_tracks_usage();
        return 1;
    }

    path = argv[optind];

    GError *error = NULL;
    Itdb_iTunesDB *itdb = itdb_parse(path, &error);

    if (!itdb) {
        if (json_output) {
            printf("{\n");
            print_json_bool("success", false, true);
            print_json_string("error", error ? error->message : "Failed to parse database", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: %s\n", error ? error->message : "Failed to parse database");
        }
        if (error) g_error_free(error);
        return 1;
    }

    if (json_output) {
        printf("{\n");
        print_json_bool("success", true, true);
        printf("  \"tracks\": [\n");

        GList *track_node;
        bool first = true;
        for (track_node = itdb->tracks; track_node; track_node = track_node->next) {
            Itdb_Track *track = (Itdb_Track *)track_node->data;

            if (!first) printf(",\n");
            first = false;

            char title[1024], artist[1024], album[1024];
            json_escape_string(track->title, title, sizeof(title));
            json_escape_string(track->artist, artist, sizeof(artist));
            json_escape_string(track->album, album, sizeof(album));

            printf("    {\n");
            printf("      \"id\": %u,\n", track->id);
            printf("      \"title\": %s,\n", title);
            printf("      \"artist\": %s,\n", artist);
            printf("      \"album\": %s,\n", album);
            printf("      \"track_number\": %d,\n", track->track_nr);
            printf("      \"duration_ms\": %d,\n", track->tracklen);
            printf("      \"bitrate\": %d,\n", track->bitrate);
            printf("      \"sample_rate\": %d,\n", track->samplerate);
            printf("      \"size\": %u,\n", track->size);
            printf("      \"has_artwork\": %s\n", track->has_artwork ? "true" : "false");
            printf("    }");
        }

        printf("\n  ]\n");
        printf("}\n");
    } else {
        int count = itdb_tracks_number(itdb);
        printf("Tracks (%d):\n", count);

        if (count == 0) {
            printf("  (none)\n");
        } else {
            GList *track_node;
            for (track_node = itdb->tracks; track_node; track_node = track_node->next) {
                Itdb_Track *track = (Itdb_Track *)track_node->data;
                printf("  [%u] %s - %s (%s)\n",
                       track->id,
                       track->artist ? track->artist : "Unknown Artist",
                       track->title ? track->title : "Unknown Title",
                       track->album ? track->album : "Unknown Album");
            }
        }
    }

    itdb_free(itdb);
    return 0;
}

/* ============================================================================
 * Command: add-track
 * ============================================================================ */

static void print_add_track_usage(void) {
    fprintf(stderr, "Usage: gpod-tool add-track <path> [options]\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Add a track entry to the database (metadata only, no file copy).\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -t, --title <title>       Track title (required)\n");
    fprintf(stderr, "  -a, --artist <artist>     Artist name\n");
    fprintf(stderr, "  -A, --album <album>       Album name\n");
    fprintf(stderr, "  -n, --track-num <num>     Track number\n");
    fprintf(stderr, "  -d, --duration <ms>       Duration in milliseconds\n");
    fprintf(stderr, "  -b, --bitrate <kbps>      Bitrate in kbps\n");
    fprintf(stderr, "  -s, --sample-rate <hz>    Sample rate in Hz\n");
    fprintf(stderr, "  -j, --json                Output as JSON\n");
    fprintf(stderr, "  -h, --help                Show this help\n");
}

static int cmd_add_track(int argc, char *argv[]) {
    const char *path = NULL;
    const char *title = NULL;
    const char *artist = NULL;
    const char *album = NULL;
    int track_num = 0;
    int duration = 0;
    int bitrate = 256;
    int sample_rate = 44100;

    static struct option long_options[] = {
        {"title",       required_argument, 0, 't'},
        {"artist",      required_argument, 0, 'a'},
        {"album",       required_argument, 0, 'A'},
        {"track-num",   required_argument, 0, 'n'},
        {"duration",    required_argument, 0, 'd'},
        {"bitrate",     required_argument, 0, 'b'},
        {"sample-rate", required_argument, 0, 's'},
        {"json",        no_argument,       0, 'j'},
        {"help",        no_argument,       0, 'h'},
        {0, 0, 0, 0}
    };

    int opt;
    optind = 1;
    while ((opt = getopt_long(argc, argv, "t:a:A:n:d:b:s:jh", long_options, NULL)) != -1) {
        switch (opt) {
            case 't': title = optarg; break;
            case 'a': artist = optarg; break;
            case 'A': album = optarg; break;
            case 'n': track_num = atoi(optarg); break;
            case 'd': duration = atoi(optarg); break;
            case 'b': bitrate = atoi(optarg); break;
            case 's': sample_rate = atoi(optarg); break;
            case 'j': json_output = true; break;
            case 'h': print_add_track_usage(); return 0;
            default:  print_add_track_usage(); return 1;
        }
    }

    if (optind >= argc) {
        fprintf(stderr, "Error: path required\n\n");
        print_add_track_usage();
        return 1;
    }

    path = argv[optind];

    if (!title) {
        fprintf(stderr, "Error: --title is required\n\n");
        print_add_track_usage();
        return 1;
    }

    GError *error = NULL;
    Itdb_iTunesDB *itdb = itdb_parse(path, &error);

    if (!itdb) {
        if (json_output) {
            printf("{\n");
            print_json_bool("success", false, true);
            print_json_string("error", error ? error->message : "Failed to parse database", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: %s\n", error ? error->message : "Failed to parse database");
        }
        if (error) g_error_free(error);
        return 1;
    }

    /* Create track */
    Itdb_Track *track = itdb_track_new();
    track->title = g_strdup(title);
    if (artist) track->artist = g_strdup(artist);
    if (album) track->album = g_strdup(album);
    track->track_nr = track_num;
    track->tracklen = duration;
    track->bitrate = bitrate;
    track->samplerate = sample_rate;
    track->filetype = g_strdup("m4a");
    track->mediatype = ITDB_MEDIATYPE_AUDIO;

    /* Add to database and master playlist */
    itdb_track_add(itdb, track, -1);

    Itdb_Playlist *mpl = itdb_playlist_mpl(itdb);
    if (mpl) {
        itdb_playlist_add_track(mpl, track, -1);
    }

    /* Write database */
    if (!itdb_write(itdb, &error)) {
        if (json_output) {
            printf("{\n");
            print_json_bool("success", false, true);
            print_json_string("error", error ? error->message : "Failed to write database", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: %s\n", error ? error->message : "Failed to write database");
        }
        if (error) g_error_free(error);
        itdb_free(itdb);
        return 1;
    }

    guint32 track_id = track->id;

    if (json_output) {
        printf("{\n");
        print_json_bool("success", true, true);
        print_json_int("track_id", track_id, true);
        print_json_string("title", title, true);
        print_json_string("artist", artist, true);
        print_json_string("album", album, false);
        printf("}\n");
    } else {
        printf("Track added successfully\n");
        printf("  ID:     %u\n", track_id);
        printf("  Title:  %s\n", title);
        printf("  Artist: %s\n", artist ? artist : "(none)");
        printf("  Album:  %s\n", album ? album : "(none)");
    }

    itdb_free(itdb);
    return 0;
}

/* ============================================================================
 * Command: verify
 * ============================================================================ */

static void print_verify_usage(void) {
    fprintf(stderr, "Usage: gpod-tool verify <path> [options]\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Verify that a database can be parsed correctly.\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -j, --json   Output as JSON\n");
    fprintf(stderr, "  -h, --help   Show this help\n");
}

static int cmd_verify(int argc, char *argv[]) {
    const char *path = NULL;

    static struct option long_options[] = {
        {"json", no_argument, 0, 'j'},
        {"help", no_argument, 0, 'h'},
        {0, 0, 0, 0}
    };

    int opt;
    optind = 1;
    while ((opt = getopt_long(argc, argv, "jh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'j': json_output = true; break;
            case 'h': print_verify_usage(); return 0;
            default:  print_verify_usage(); return 1;
        }
    }

    if (optind >= argc) {
        fprintf(stderr, "Error: path required\n\n");
        print_verify_usage();
        return 1;
    }

    path = argv[optind];

    /* Check directory exists */
    if (!g_file_test(path, G_FILE_TEST_IS_DIR)) {
        if (json_output) {
            printf("{\n");
            print_json_bool("valid", false, true);
            print_json_string("error", "Path does not exist or is not a directory", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: Path does not exist or is not a directory: %s\n", path);
        }
        return 1;
    }

    /* Check for iTunesDB */
    char itunes_db_path[4096];
    snprintf(itunes_db_path, sizeof(itunes_db_path), "%s/iPod_Control/iTunes/iTunesDB", path);
    if (!g_file_test(itunes_db_path, G_FILE_TEST_EXISTS)) {
        if (json_output) {
            printf("{\n");
            print_json_bool("valid", false, true);
            print_json_string("error", "iTunesDB not found", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: iTunesDB not found at %s\n", itunes_db_path);
        }
        return 1;
    }

    /* Try to parse */
    GError *error = NULL;
    Itdb_iTunesDB *itdb = itdb_parse(path, &error);

    if (!itdb) {
        if (json_output) {
            printf("{\n");
            print_json_bool("valid", false, true);
            print_json_string("error", error ? error->message : "Failed to parse database", false);
            printf("}\n");
        } else {
            fprintf(stderr, "Error: %s\n", error ? error->message : "Failed to parse database");
        }
        if (error) g_error_free(error);
        return 1;
    }

    int track_count = itdb_tracks_number(itdb);
    int playlist_count = itdb_playlists_number(itdb);

    if (json_output) {
        printf("{\n");
        print_json_bool("valid", true, true);
        print_json_string("path", path, true);
        print_json_int("track_count", track_count, true);
        print_json_int("playlist_count", playlist_count, false);
        printf("}\n");
    } else {
        printf("Database is valid\n");
        printf("  Path:      %s\n", path);
        printf("  Tracks:    %d\n", track_count);
        printf("  Playlists: %d\n", playlist_count);
    }

    itdb_free(itdb);
    return 0;
}

/* ============================================================================
 * Main
 * ============================================================================ */

static void print_usage(void) {
    fprintf(stderr, "gpod-tool %s - libgpod command-line utility\n", VERSION);
    fprintf(stderr, "\n");
    fprintf(stderr, "Usage: gpod-tool <command> <path> [options]\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Commands:\n");
    fprintf(stderr, "  init        Create a new iPod database structure\n");
    fprintf(stderr, "  info        Display database information\n");
    fprintf(stderr, "  tracks      List all tracks\n");
    fprintf(stderr, "  add-track   Add a track entry (metadata only)\n");
    fprintf(stderr, "  verify      Verify database can be parsed\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -j, --json  Output as JSON (all commands)\n");
    fprintf(stderr, "  -h, --help  Show help for command\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Examples:\n");
    fprintf(stderr, "  gpod-tool init ./test-ipod --model MA147\n");
    fprintf(stderr, "  gpod-tool info ./test-ipod --json\n");
    fprintf(stderr, "  gpod-tool add-track ./test-ipod -t \"Song\" -a \"Artist\"\n");
    fprintf(stderr, "  gpod-tool verify ./test-ipod\n");
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        print_usage();
        return 1;
    }

    const char *command = argv[1];

    /* Check for global --help or -h */
    if (strcmp(command, "--help") == 0 || strcmp(command, "-h") == 0) {
        print_usage();
        return 0;
    }

    /* Check for --version */
    if (strcmp(command, "--version") == 0 || strcmp(command, "-v") == 0) {
        printf("gpod-tool %s\n", VERSION);
        return 0;
    }

    /* Dispatch to command handlers */
    /* Shift argv so command handlers see: <command> <path> [options] */
    argc--;
    argv++;

    if (strcmp(command, "init") == 0) {
        return cmd_init(argc, argv);
    } else if (strcmp(command, "info") == 0) {
        return cmd_info(argc, argv);
    } else if (strcmp(command, "tracks") == 0) {
        return cmd_tracks(argc, argv);
    } else if (strcmp(command, "add-track") == 0) {
        return cmd_add_track(argc, argv);
    } else if (strcmp(command, "verify") == 0) {
        return cmd_verify(argc, argv);
    } else {
        fprintf(stderr, "Unknown command: %s\n\n", command);
        print_usage();
        return 1;
    }
}
