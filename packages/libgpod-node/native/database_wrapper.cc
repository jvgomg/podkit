/**
 * DatabaseWrapper core methods implementation.
 * Constructor, destructor, Init, NewInstance, and core database operations.
 */

#include "database_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"

Napi::FunctionReference DatabaseWrapper::constructor;

Napi::Object DatabaseWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "Database", {
        // Core methods
        InstanceMethod("getInfo", &DatabaseWrapper::GetInfo),
        InstanceMethod("getTracks", &DatabaseWrapper::GetTracks),
        InstanceMethod("getPlaylists", &DatabaseWrapper::GetPlaylists),
        InstanceMethod("write", &DatabaseWrapper::Write),
        InstanceMethod("close", &DatabaseWrapper::Close),
        InstanceMethod("getMountpoint", &DatabaseWrapper::GetMountpoint),
        // Track methods
        InstanceMethod("getTrackById", &DatabaseWrapper::GetTrackById),
        InstanceMethod("addTrack", &DatabaseWrapper::AddTrack),
        InstanceMethod("removeTrack", &DatabaseWrapper::RemoveTrack),
        InstanceMethod("copyTrackToDevice", &DatabaseWrapper::CopyTrackToDevice),
        // Artwork methods
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
