/**
 * N-API C++ bindings for libgpod.
 *
 * This file provides a thin wrapper around libgpod functions,
 * handling GLib memory management and converting between C and JS types.
 */

#include <napi.h>
#include <gpod/itdb.h>
#include <string>
#include <cstring>
#include <set>

// Helper to convert gchar* to Napi::Value, handling NULL
static Napi::Value GcharToValue(Napi::Env env, const gchar* str) {
    if (str == nullptr) {
        return env.Null();
    }
    return Napi::String::New(env, str);
}

// Helper to convert string value to gchar*, returns nullptr for null/undefined
static gchar* ValueToGchar(const Napi::Value& value) {
    if (value.IsNull() || value.IsUndefined()) {
        return nullptr;
    }
    std::string str = value.As<Napi::String>().Utf8Value();
    return g_strdup(str.c_str());
}

// Helper to get optional number with default
static int32_t GetOptionalInt32(const Napi::Object& obj, const char* key, int32_t defaultValue) {
    if (obj.Has(key) && !obj.Get(key).IsNull() && !obj.Get(key).IsUndefined()) {
        return obj.Get(key).As<Napi::Number>().Int32Value();
    }
    return defaultValue;
}

// Helper to get optional boolean
static bool GetOptionalBool(const Napi::Object& obj, const char* key, bool defaultValue) {
    if (obj.Has(key) && !obj.Get(key).IsNull() && !obj.Get(key).IsUndefined()) {
        return obj.Get(key).As<Napi::Boolean>().Value();
    }
    return defaultValue;
}

// Helper to get optional string
static gchar* GetOptionalString(const Napi::Object& obj, const char* key) {
    if (obj.Has(key)) {
        return ValueToGchar(obj.Get(key));
    }
    return nullptr;
}

// Convert Itdb_IpodGeneration to string
static const char* GenerationToString(Itdb_IpodGeneration gen) {
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

// Convert Itdb_IpodModel to string
static const char* ModelToString(Itdb_IpodModel model) {
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

// Convert device info to JS object
static Napi::Object DeviceInfoToObject(Napi::Env env, const Itdb_Device* device) {
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

// Convert track to JS object
static Napi::Object TrackToObject(Napi::Env env, const Itdb_Track* track) {
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

// Convert playlist to JS object
static Napi::Object PlaylistToObject(Napi::Env env, const Itdb_Playlist* pl) {
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

/**
 * DatabaseWrapper class wraps an Itdb_iTunesDB pointer.
 */
class DatabaseWrapper : public Napi::ObjectWrap<DatabaseWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, Itdb_iTunesDB* db);
    DatabaseWrapper(const Napi::CallbackInfo& info);
    ~DatabaseWrapper();

    // Set the database pointer (called from Parse)
    void SetDatabase(Itdb_iTunesDB* db) { db_ = db; }

private:
    static Napi::FunctionReference constructor;
    Itdb_iTunesDB* db_;

    // Methods
    Napi::Value GetInfo(const Napi::CallbackInfo& info);
    Napi::Value GetTracks(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylists(const Napi::CallbackInfo& info);
    Napi::Value AddTrack(const Napi::CallbackInfo& info);
    Napi::Value RemoveTrack(const Napi::CallbackInfo& info);
    Napi::Value CopyTrackToDevice(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
    Napi::Value GetMountpoint(const Napi::CallbackInfo& info);
    Napi::Value GetTrackById(const Napi::CallbackInfo& info);
    Napi::Value SetTrackThumbnails(const Napi::CallbackInfo& info);
    Napi::Value SetTrackThumbnailsFromData(const Napi::CallbackInfo& info);
    Napi::Value RemoveTrackThumbnails(const Napi::CallbackInfo& info);
    Napi::Value HasTrackThumbnails(const Napi::CallbackInfo& info);
    Napi::Value GetUniqueArtworkIds(const Napi::CallbackInfo& info);
    Napi::Value GetArtworkFormats(const Napi::CallbackInfo& info);

    // Playlist methods
    Napi::Value CreatePlaylist(const Napi::CallbackInfo& info);
    Napi::Value RemovePlaylist(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylistById(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylistByName(const Napi::CallbackInfo& info);
    Napi::Value SetPlaylistName(const Napi::CallbackInfo& info);
    Napi::Value AddTrackToPlaylist(const Napi::CallbackInfo& info);
    Napi::Value RemoveTrackFromPlaylist(const Napi::CallbackInfo& info);
    Napi::Value PlaylistContainsTrack(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylistTracks(const Napi::CallbackInfo& info);
};

Napi::FunctionReference DatabaseWrapper::constructor;

Napi::Object DatabaseWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "Database", {
        InstanceMethod("getInfo", &DatabaseWrapper::GetInfo),
        InstanceMethod("getTracks", &DatabaseWrapper::GetTracks),
        InstanceMethod("getPlaylists", &DatabaseWrapper::GetPlaylists),
        InstanceMethod("addTrack", &DatabaseWrapper::AddTrack),
        InstanceMethod("removeTrack", &DatabaseWrapper::RemoveTrack),
        InstanceMethod("copyTrackToDevice", &DatabaseWrapper::CopyTrackToDevice),
        InstanceMethod("write", &DatabaseWrapper::Write),
        InstanceMethod("close", &DatabaseWrapper::Close),
        InstanceMethod("getMountpoint", &DatabaseWrapper::GetMountpoint),
        InstanceMethod("getTrackById", &DatabaseWrapper::GetTrackById),
        InstanceMethod("setTrackThumbnails", &DatabaseWrapper::SetTrackThumbnails),
        InstanceMethod("setTrackThumbnailsFromData", &DatabaseWrapper::SetTrackThumbnailsFromData),
        InstanceMethod("removeTrackThumbnails", &DatabaseWrapper::RemoveTrackThumbnails),
        InstanceMethod("hasTrackThumbnails", &DatabaseWrapper::HasTrackThumbnails),
        InstanceMethod("getUniqueArtworkIds", &DatabaseWrapper::GetUniqueArtworkIds),
        InstanceMethod("getArtworkFormats", &DatabaseWrapper::GetArtworkFormats),
        // Playlist methods
        InstanceMethod("createPlaylist", &DatabaseWrapper::CreatePlaylist),
        InstanceMethod("removePlaylist", &DatabaseWrapper::RemovePlaylist),
        InstanceMethod("getPlaylistById", &DatabaseWrapper::GetPlaylistById),
        InstanceMethod("getPlaylistByName", &DatabaseWrapper::GetPlaylistByName),
        InstanceMethod("setPlaylistName", &DatabaseWrapper::SetPlaylistName),
        InstanceMethod("addTrackToPlaylist", &DatabaseWrapper::AddTrackToPlaylist),
        InstanceMethod("removeTrackFromPlaylist", &DatabaseWrapper::RemoveTrackFromPlaylist),
        InstanceMethod("playlistContainsTrack", &DatabaseWrapper::PlaylistContainsTrack),
        InstanceMethod("getPlaylistTracks", &DatabaseWrapper::GetPlaylistTracks),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Database", func);
    return exports;
}

Napi::Object DatabaseWrapper::NewInstance(Napi::Env env, Itdb_iTunesDB* db) {
    Napi::Object wrapper = constructor.New({});
    DatabaseWrapper* unwrapped = Napi::ObjectWrap<DatabaseWrapper>::Unwrap(wrapper);
    unwrapped->SetDatabase(db);
    return wrapper;
}

DatabaseWrapper::DatabaseWrapper(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<DatabaseWrapper>(info), db_(nullptr) {
    // Constructor is called from JS but database is set via NewInstance()
}

DatabaseWrapper::~DatabaseWrapper() {
    if (db_) {
        itdb_free(db_);
        db_ = nullptr;
    }
}

Napi::Value DatabaseWrapper::GetInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);

    result.Set("mountpoint", GcharToValue(env, itdb_get_mountpoint(db_)));
    result.Set("version", Napi::Number::New(env, db_->version));
    result.Set("id", Napi::BigInt::New(env, static_cast<uint64_t>(db_->id)));
    result.Set("trackCount", Napi::Number::New(env, itdb_tracks_number(db_)));
    result.Set("playlistCount", Napi::Number::New(env, itdb_playlists_number(db_)));

    if (db_->device) {
        result.Set("device", DeviceInfoToObject(env, db_->device));
    } else {
        result.Set("device", env.Null());
    }

    return result;
}

Napi::Value DatabaseWrapper::GetTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = db_->tracks; l != nullptr; l = l->next) {
        Itdb_Track* track = static_cast<Itdb_Track*>(l->data);
        result.Set(index++, TrackToObject(env, track));
    }

    return result;
}

Napi::Value DatabaseWrapper::GetPlaylists(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = db_->playlists; l != nullptr; l = l->next) {
        Itdb_Playlist* pl = static_cast<Itdb_Playlist*>(l->data);
        result.Set(index++, PlaylistToObject(env, pl));
    }

    return result;
}

Napi::Value DatabaseWrapper::AddTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected track object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object input = info[0].As<Napi::Object>();

    // Create new track
    Itdb_Track* track = itdb_track_new();
    if (!track) {
        Napi::Error::New(env, "Failed to create track").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Set metadata from input object
    track->title = GetOptionalString(input, "title");
    track->artist = GetOptionalString(input, "artist");
    track->album = GetOptionalString(input, "album");
    track->albumartist = GetOptionalString(input, "albumArtist");
    track->genre = GetOptionalString(input, "genre");
    track->composer = GetOptionalString(input, "composer");
    track->comment = GetOptionalString(input, "comment");
    track->grouping = GetOptionalString(input, "grouping");

    track->track_nr = GetOptionalInt32(input, "trackNumber", 0);
    track->tracks = GetOptionalInt32(input, "totalTracks", 0);
    track->cd_nr = GetOptionalInt32(input, "discNumber", 0);
    track->cds = GetOptionalInt32(input, "totalDiscs", 0);
    track->year = GetOptionalInt32(input, "year", 0);

    track->tracklen = GetOptionalInt32(input, "duration", 0);
    track->bitrate = GetOptionalInt32(input, "bitrate", 0);
    track->samplerate = static_cast<guint16>(GetOptionalInt32(input, "sampleRate", 0));
    track->size = GetOptionalInt32(input, "size", 0);
    track->BPM = static_cast<gint16>(GetOptionalInt32(input, "bpm", 0));

    track->filetype = GetOptionalString(input, "filetype");
    track->mediatype = GetOptionalInt32(input, "mediaType", ITDB_MEDIATYPE_AUDIO);

    track->compilation = GetOptionalBool(input, "compilation", false) ? 1 : 0;

    // Set time added to now
    track->time_added = time(nullptr);
    track->time_modified = track->time_added;

    // Add to database at end (-1)
    itdb_track_add(db_, track, -1);

    // Also add to master playlist
    Itdb_Playlist* mpl = itdb_playlist_mpl(db_);
    if (mpl) {
        itdb_playlist_add_track(mpl, track, -1);
    }

    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::RemoveTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    Itdb_Track* track = itdb_track_by_id(db_, trackId);

    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    itdb_track_remove(track);
    return env.Undefined();
}

Napi::Value DatabaseWrapper::CopyTrackToDevice(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected track ID and source file path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsString()) {
        Napi::TypeError::New(env, "Expected source file path as string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    std::string sourcePath = info[1].As<Napi::String>().Utf8Value();

    // Find the track by ID
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Copy the file to the iPod
    GError* error = nullptr;
    gboolean success = itdb_cp_track_to_ipod(track, sourcePath.c_str(), &error);

    if (!success) {
        std::string message = "Failed to copy track to iPod";
        if (error) {
            message = error->message;
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Return the updated track object with the new ipod_path
    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    GError* error = nullptr;
    gboolean success = itdb_write(db_, &error);

    if (!success) {
        std::string message = error ? error->message : "Failed to write database";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value DatabaseWrapper::Close(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (db_) {
        itdb_free(db_);
        db_ = nullptr;
    }

    return env.Undefined();
}

Napi::Value DatabaseWrapper::GetMountpoint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return GcharToValue(env, itdb_get_mountpoint(db_));
}

Napi::Value DatabaseWrapper::GetTrackById(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    Itdb_Track* track = itdb_track_by_id(db_, trackId);

    if (!track) {
        return env.Null();
    }

    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::SetTrackThumbnails(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected track ID and image path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsString()) {
        Napi::TypeError::New(env, "Expected image path as string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    std::string imagePath = info[1].As<Napi::String>().Utf8Value();

    // Find the track by ID
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Set thumbnails using libgpod
    // libgpod automatically handles resizing and format conversion
    gboolean success = itdb_track_set_thumbnails(track, imagePath.c_str());

    if (!success) {
        Napi::Error::New(env, "Failed to set track thumbnails - check image file exists and is valid").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Return the updated track object
    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::GetUniqueArtworkIds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Use a set to collect unique mhii_link values
    // We'll use a simple approach: iterate through all tracks and collect non-zero mhii_link values
    std::set<uint32_t> uniqueIds;

    for (GList* l = db_->tracks; l != nullptr; l = l->next) {
        Itdb_Track* track = static_cast<Itdb_Track*>(l->data);
        // Only include non-zero mhii_link values (0 means no artwork)
        if (track->mhii_link != 0) {
            uniqueIds.insert(track->mhii_link);
        }
    }

    // Convert to Napi::Array
    Napi::Array result = Napi::Array::New(env, uniqueIds.size());
    uint32_t index = 0;
    for (uint32_t id : uniqueIds) {
        result.Set(index++, Napi::Number::New(env, id));
    }

    return result;
}

Napi::Value DatabaseWrapper::SetTrackThumbnailsFromData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected track ID and image data buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsBuffer()) {
        Napi::TypeError::New(env, "Expected image data as Buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    Napi::Buffer<guchar> buffer = info[1].As<Napi::Buffer<guchar>>();

    // Find the track by ID
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Set thumbnails from raw image data
    gboolean success = itdb_track_set_thumbnails_from_data(
        track,
        buffer.Data(),
        static_cast<gsize>(buffer.Length())
    );

    if (!success) {
        Napi::Error::New(env, "Failed to set track thumbnails from data - check image data is valid").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Return the updated track object
    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::RemoveTrackThumbnails(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();

    // Find the track by ID
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Remove thumbnails from the track
    itdb_track_remove_thumbnails(track);

    // Return the updated track object
    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::HasTrackThumbnails(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();

    // Find the track by ID
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Check if track has thumbnails
    gboolean hasThumbnails = itdb_track_has_thumbnails(track);

    return Napi::Boolean::New(env, hasThumbnails != FALSE);
}

Napi::Value DatabaseWrapper::GetArtworkFormats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Note: itdb_device_get_cover_art_formats is an internal API.
    // We return basic artwork capability information from the device.
    // The actual formats used are determined internally by libgpod when
    // setting thumbnails.

    Napi::Object result = Napi::Object::New(env);

    if (db_->device) {
        result.Set("supportsArtwork", Napi::Boolean::New(env,
            itdb_device_supports_artwork(db_->device)));

        // Get device info for additional context
        const Itdb_IpodInfo* ipodInfo = itdb_device_get_ipod_info(db_->device);
        if (ipodInfo) {
            result.Set("generation", Napi::String::New(env, GenerationToString(ipodInfo->ipod_generation)));
            result.Set("model", Napi::String::New(env, ModelToString(ipodInfo->ipod_model)));
        } else {
            result.Set("generation", Napi::String::New(env, "unknown"));
            result.Set("model", Napi::String::New(env, "unknown"));
        }
    } else {
        result.Set("supportsArtwork", Napi::Boolean::New(env, false));
        result.Set("generation", Napi::String::New(env, "unknown"));
        result.Set("model", Napi::String::New(env, "unknown"));
    }

    return result;
}

// ============================================================================
// Playlist methods
// ============================================================================

Napi::Value DatabaseWrapper::CreatePlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected playlist name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();

    // Create a new regular playlist (not smart playlist)
    Itdb_Playlist* pl = itdb_playlist_new(name.c_str(), FALSE);
    if (!pl) {
        Napi::Error::New(env, "Failed to create playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Add to database at end (-1)
    itdb_playlist_add(db_, pl, -1);

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::RemovePlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Check if it's the master playlist - cannot delete it
    if (itdb_playlist_is_mpl(pl)) {
        Napi::Error::New(env, "Cannot delete the master playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    itdb_playlist_remove(pl);
    return env.Undefined();
}

Napi::Value DatabaseWrapper::GetPlaylistById(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        return env.Null();
    }

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::GetPlaylistByName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected playlist name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();

    Itdb_Playlist* pl = itdb_playlist_by_name(db_, const_cast<gchar*>(name.c_str()));
    if (!pl) {
        return env.Null();
    }

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::SetPlaylistName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and new name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsString()) {
        Napi::TypeError::New(env, "Expected new name as string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    std::string newName = info[1].As<Napi::String>().Utf8Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Free old name and set new one
    g_free(pl->name);
    pl->name = g_strdup(newName.c_str());

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::AddTrackToPlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t trackId = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Add track to playlist at end (-1)
    itdb_playlist_add_track(pl, track, -1);

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::RemoveTrackFromPlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t trackId = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Remove track from playlist
    itdb_playlist_remove_track(pl, track);

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::PlaylistContainsTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t trackId = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gboolean contains = itdb_playlist_contains_track(pl, track);
    return Napi::Boolean::New(env, contains != FALSE);
}

Napi::Value DatabaseWrapper::GetPlaylistTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = pl->members; l != nullptr; l = l->next) {
        Itdb_Track* track = static_cast<Itdb_Track*>(l->data);
        result.Set(index++, TrackToObject(env, track));
    }

    return result;
}

/**
 * Parse an iPod database from a mountpoint.
 * @param mountpoint Path to iPod mount point
 * @returns Database object
 */
Napi::Value Parse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected mountpoint path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string mountpoint = info[0].As<Napi::String>().Utf8Value();

    GError* error = nullptr;
    Itdb_iTunesDB* db = itdb_parse(mountpoint.c_str(), &error);

    if (!db) {
        std::string message = error ? error->message : "Failed to parse database";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Create a new DatabaseWrapper and set its internal pointer
    return DatabaseWrapper::NewInstance(env, db);
}

/**
 * Get libgpod version information.
 */
Napi::Value GetVersion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    // libgpod doesn't export version macros easily, so we hardcode 0.8.3
    result.Set("major", Napi::Number::New(env, 0));
    result.Set("minor", Napi::Number::New(env, 8));
    result.Set("patch", Napi::Number::New(env, 3));
    result.Set("string", Napi::String::New(env, "0.8.3"));

    return result;
}

/**
 * Module initialization.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    DatabaseWrapper::Init(env, exports);

    exports.Set("parse", Napi::Function::New(env, Parse));
    exports.Set("getVersion", Napi::Function::New(env, GetVersion));

    return exports;
}

NODE_API_MODULE(gpod_binding, Init)
