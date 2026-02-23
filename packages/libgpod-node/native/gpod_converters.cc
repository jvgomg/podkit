/**
 * Enum-to-string and object conversion functions for libgpod types.
 */

#include "gpod_converters.h"
#include "gpod_helpers.h"

const char* GenerationToString(Itdb_IpodGeneration gen) {
    switch (gen) {
        case ITDB_IPOD_GENERATION_UNKNOWN: return "unknown";
        case ITDB_IPOD_GENERATION_FIRST: return "first";
        case ITDB_IPOD_GENERATION_SECOND: return "second";
        case ITDB_IPOD_GENERATION_THIRD: return "third";
        case ITDB_IPOD_GENERATION_FOURTH: return "fourth";
        case ITDB_IPOD_GENERATION_PHOTO: return "photo";
        case ITDB_IPOD_GENERATION_MOBILE: return "mobile";
        case ITDB_IPOD_GENERATION_MINI_1: return "mini_1";
        case ITDB_IPOD_GENERATION_MINI_2: return "mini_2";
        case ITDB_IPOD_GENERATION_SHUFFLE_1: return "shuffle_1";
        case ITDB_IPOD_GENERATION_SHUFFLE_2: return "shuffle_2";
        case ITDB_IPOD_GENERATION_SHUFFLE_3: return "shuffle_3";
        case ITDB_IPOD_GENERATION_SHUFFLE_4: return "shuffle_4";
        case ITDB_IPOD_GENERATION_NANO_1: return "nano_1";
        case ITDB_IPOD_GENERATION_NANO_2: return "nano_2";
        case ITDB_IPOD_GENERATION_NANO_3: return "nano_3";
        case ITDB_IPOD_GENERATION_NANO_4: return "nano_4";
        case ITDB_IPOD_GENERATION_NANO_5: return "nano_5";
        case ITDB_IPOD_GENERATION_NANO_6: return "nano_6";
        case ITDB_IPOD_GENERATION_VIDEO_1: return "video_1";
        case ITDB_IPOD_GENERATION_VIDEO_2: return "video_2";
        case ITDB_IPOD_GENERATION_CLASSIC_1: return "classic_1";
        case ITDB_IPOD_GENERATION_CLASSIC_2: return "classic_2";
        case ITDB_IPOD_GENERATION_CLASSIC_3: return "classic_3";
        case ITDB_IPOD_GENERATION_TOUCH_1: return "touch_1";
        case ITDB_IPOD_GENERATION_TOUCH_2: return "touch_2";
        case ITDB_IPOD_GENERATION_TOUCH_3: return "touch_3";
        case ITDB_IPOD_GENERATION_TOUCH_4: return "touch_4";
        case ITDB_IPOD_GENERATION_IPHONE_1: return "iphone_1";
        case ITDB_IPOD_GENERATION_IPHONE_2: return "iphone_2";
        case ITDB_IPOD_GENERATION_IPHONE_3: return "iphone_3";
        case ITDB_IPOD_GENERATION_IPHONE_4: return "iphone_4";
        case ITDB_IPOD_GENERATION_IPAD_1: return "ipad_1";
        default: return "unknown";
    }
}

const char* ModelToString(Itdb_IpodModel model) {
    switch (model) {
        case ITDB_IPOD_MODEL_INVALID: return "invalid";
        case ITDB_IPOD_MODEL_UNKNOWN: return "unknown";
        case ITDB_IPOD_MODEL_COLOR: return "color";
        case ITDB_IPOD_MODEL_COLOR_U2: return "color_u2";
        case ITDB_IPOD_MODEL_REGULAR: return "regular";
        case ITDB_IPOD_MODEL_REGULAR_U2: return "regular_u2";
        case ITDB_IPOD_MODEL_MINI: return "mini";
        case ITDB_IPOD_MODEL_MINI_BLUE: return "mini_blue";
        case ITDB_IPOD_MODEL_MINI_PINK: return "mini_pink";
        case ITDB_IPOD_MODEL_MINI_GREEN: return "mini_green";
        case ITDB_IPOD_MODEL_MINI_GOLD: return "mini_gold";
        case ITDB_IPOD_MODEL_SHUFFLE: return "shuffle";
        case ITDB_IPOD_MODEL_NANO_WHITE: return "nano_white";
        case ITDB_IPOD_MODEL_NANO_BLACK: return "nano_black";
        case ITDB_IPOD_MODEL_VIDEO_WHITE: return "video_white";
        case ITDB_IPOD_MODEL_VIDEO_BLACK: return "video_black";
        case ITDB_IPOD_MODEL_MOBILE_1: return "mobile_1";
        case ITDB_IPOD_MODEL_VIDEO_U2: return "video_u2";
        case ITDB_IPOD_MODEL_NANO_SILVER: return "nano_silver";
        case ITDB_IPOD_MODEL_NANO_BLUE: return "nano_blue";
        case ITDB_IPOD_MODEL_NANO_GREEN: return "nano_green";
        case ITDB_IPOD_MODEL_NANO_PINK: return "nano_pink";
        case ITDB_IPOD_MODEL_NANO_RED: return "nano_red";
        case ITDB_IPOD_MODEL_NANO_YELLOW: return "nano_yellow";
        case ITDB_IPOD_MODEL_NANO_PURPLE: return "nano_purple";
        case ITDB_IPOD_MODEL_NANO_ORANGE: return "nano_orange";
        case ITDB_IPOD_MODEL_IPHONE_1: return "iphone_1";
        case ITDB_IPOD_MODEL_SHUFFLE_SILVER: return "shuffle_silver";
        case ITDB_IPOD_MODEL_SHUFFLE_PINK: return "shuffle_pink";
        case ITDB_IPOD_MODEL_SHUFFLE_BLUE: return "shuffle_blue";
        case ITDB_IPOD_MODEL_SHUFFLE_GREEN: return "shuffle_green";
        case ITDB_IPOD_MODEL_SHUFFLE_ORANGE: return "shuffle_orange";
        case ITDB_IPOD_MODEL_SHUFFLE_PURPLE: return "shuffle_purple";
        case ITDB_IPOD_MODEL_SHUFFLE_RED: return "shuffle_red";
        case ITDB_IPOD_MODEL_SHUFFLE_BLACK: return "shuffle_black";
        case ITDB_IPOD_MODEL_SHUFFLE_GOLD: return "shuffle_gold";
        case ITDB_IPOD_MODEL_SHUFFLE_STAINLESS: return "shuffle_stainless";
        case ITDB_IPOD_MODEL_CLASSIC_SILVER: return "classic_silver";
        case ITDB_IPOD_MODEL_CLASSIC_BLACK: return "classic_black";
        case ITDB_IPOD_MODEL_TOUCH_SILVER: return "touch_silver";
        case ITDB_IPOD_MODEL_IPHONE_WHITE: return "iphone_white";
        case ITDB_IPOD_MODEL_IPHONE_BLACK: return "iphone_black";
        case ITDB_IPOD_MODEL_IPAD: return "ipad";
        default: return "unknown";
    }
}

Napi::Object DeviceInfoToObject(Napi::Env env, const Itdb_Device* device) {
    Napi::Object obj = Napi::Object::New(env);

    const Itdb_IpodInfo* info = itdb_device_get_ipod_info(device);
    if (info) {
        obj.Set("modelNumber", GcharToValue(env, info->model_number));
        obj.Set("modelName", Napi::String::New(env,
            itdb_info_get_ipod_model_name_string(info->ipod_model) ?: "Unknown"));
        obj.Set("generation", Napi::String::New(env, GenerationToString(info->ipod_generation)));
        obj.Set("model", Napi::String::New(env, ModelToString(info->ipod_model)));
        obj.Set("capacity", Napi::Number::New(env, info->capacity));
        obj.Set("musicDirs", Napi::Number::New(env, info->musicdirs));
    } else {
        obj.Set("modelNumber", env.Null());
        obj.Set("modelName", Napi::String::New(env, "Unknown"));
        obj.Set("generation", Napi::String::New(env, "unknown"));
        obj.Set("model", Napi::String::New(env, "unknown"));
        obj.Set("capacity", Napi::Number::New(env, 0));
        obj.Set("musicDirs", Napi::Number::New(env, 0));
    }

    obj.Set("supportsArtwork", Napi::Boolean::New(env, itdb_device_supports_artwork(device)));
    obj.Set("supportsVideo", Napi::Boolean::New(env, itdb_device_supports_video(device)));
    obj.Set("supportsPhoto", Napi::Boolean::New(env, itdb_device_supports_photo(device)));
    obj.Set("supportsPodcast", Napi::Boolean::New(env, itdb_device_supports_podcast(device)));

    return obj;
}

Napi::Object TrackToObject(Napi::Env env, const Itdb_Track* track) {
    Napi::Object obj = Napi::Object::New(env);

    obj.Set("id", Napi::Number::New(env, track->id));
    obj.Set("dbid", Napi::BigInt::New(env, static_cast<uint64_t>(track->dbid)));

    // Core metadata
    obj.Set("title", GcharToValue(env, track->title));
    obj.Set("artist", GcharToValue(env, track->artist));
    obj.Set("album", GcharToValue(env, track->album));
    obj.Set("albumArtist", GcharToValue(env, track->albumartist));
    obj.Set("genre", GcharToValue(env, track->genre));
    obj.Set("composer", GcharToValue(env, track->composer));
    obj.Set("comment", GcharToValue(env, track->comment));
    obj.Set("grouping", GcharToValue(env, track->grouping));

    // Track info
    obj.Set("trackNumber", Napi::Number::New(env, track->track_nr));
    obj.Set("totalTracks", Napi::Number::New(env, track->tracks));
    obj.Set("discNumber", Napi::Number::New(env, track->cd_nr));
    obj.Set("totalDiscs", Napi::Number::New(env, track->cds));
    obj.Set("year", Napi::Number::New(env, track->year));

    // Technical info
    obj.Set("duration", Napi::Number::New(env, track->tracklen));
    obj.Set("bitrate", Napi::Number::New(env, track->bitrate));
    obj.Set("sampleRate", Napi::Number::New(env, track->samplerate));
    obj.Set("size", Napi::Number::New(env, track->size));
    obj.Set("bpm", Napi::Number::New(env, track->BPM));

    // File type
    obj.Set("filetype", GcharToValue(env, track->filetype));
    obj.Set("mediaType", Napi::Number::New(env, track->mediatype));

    // Path
    obj.Set("ipodPath", GcharToValue(env, track->ipod_path));

    // Timestamps
    obj.Set("timeAdded", Napi::Number::New(env, static_cast<double>(track->time_added)));
    obj.Set("timeModified", Napi::Number::New(env, static_cast<double>(track->time_modified)));
    obj.Set("timePlayed", Napi::Number::New(env, static_cast<double>(track->time_played)));
    obj.Set("timeReleased", Napi::Number::New(env, static_cast<double>(track->time_released)));

    // Play statistics
    obj.Set("playCount", Napi::Number::New(env, track->playcount));
    obj.Set("skipCount", Napi::Number::New(env, track->skipcount));
    obj.Set("rating", Napi::Number::New(env, track->rating));

    // Artwork
    // has_artwork values: 0x00 = never had, 0x01 = has artwork, 0x02 = removed
    obj.Set("hasArtwork", Napi::Boolean::New(env, track->has_artwork == 0x01));

    // Compilation
    obj.Set("compilation", Napi::Boolean::New(env, track->compilation != 0));

    // Transfer status
    obj.Set("transferred", Napi::Boolean::New(env, track->transferred));

    return obj;
}

Napi::Object PlaylistToObject(Napi::Env env, const Itdb_Playlist* pl) {
    Napi::Object obj = Napi::Object::New(env);

    obj.Set("id", Napi::BigInt::New(env, static_cast<uint64_t>(pl->id)));
    obj.Set("name", GcharToValue(env, pl->name));
    obj.Set("isMaster", Napi::Boolean::New(env, itdb_playlist_is_mpl(const_cast<Itdb_Playlist*>(pl))));
    obj.Set("isSmart", Napi::Boolean::New(env, pl->is_spl));
    obj.Set("isPodcasts", Napi::Boolean::New(env, itdb_playlist_is_podcasts(const_cast<Itdb_Playlist*>(pl))));
    // Count members directly since pl->num may not be kept in sync by libgpod
    obj.Set("trackCount", Napi::Number::New(env, g_list_length(pl->members)));
    obj.Set("timestamp", Napi::Number::New(env, static_cast<double>(pl->timestamp)));

    return obj;
}
