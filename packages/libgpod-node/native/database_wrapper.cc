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
        InstanceMethod("getTrackByDbId", &DatabaseWrapper::GetTrackByDbId),
        InstanceMethod("addTrack", &DatabaseWrapper::AddTrack),
        InstanceMethod("removeTrack", &DatabaseWrapper::RemoveTrack),
        InstanceMethod("copyTrackToDevice", &DatabaseWrapper::CopyTrackToDevice),
        InstanceMethod("updateTrack", &DatabaseWrapper::UpdateTrack),
        InstanceMethod("getTrackFilePath", &DatabaseWrapper::GetTrackFilePath),
        InstanceMethod("duplicateTrack", &DatabaseWrapper::DuplicateTrack),
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
        // Device capability methods
        InstanceMethod("getDeviceCapabilities", &DatabaseWrapper::GetDeviceCapabilities),
        InstanceMethod("getSysInfo", &DatabaseWrapper::GetSysInfo),
        InstanceMethod("setSysInfo", &DatabaseWrapper::SetSysInfo),
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

Napi::Value DatabaseWrapper::GetDeviceCapabilities(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);

    if (!db_->device) {
        // No device info available - return empty/default capabilities
        result.Set("supportsArtwork", Napi::Boolean::New(env, false));
        result.Set("supportsVideo", Napi::Boolean::New(env, false));
        result.Set("supportsPhoto", Napi::Boolean::New(env, false));
        result.Set("supportsPodcast", Napi::Boolean::New(env, false));
        result.Set("supportsChapterImage", Napi::Boolean::New(env, false));
        result.Set("generation", Napi::String::New(env, "unknown"));
        result.Set("model", Napi::String::New(env, "unknown"));
        result.Set("modelNumber", env.Null());
        result.Set("modelName", Napi::String::New(env, "Unknown"));
        return result;
    }

    const Itdb_Device* device = db_->device;

    // Device capability checks
    result.Set("supportsArtwork", Napi::Boolean::New(env, itdb_device_supports_artwork(device)));
    result.Set("supportsVideo", Napi::Boolean::New(env, itdb_device_supports_video(device)));
    result.Set("supportsPhoto", Napi::Boolean::New(env, itdb_device_supports_photo(device)));
    result.Set("supportsPodcast", Napi::Boolean::New(env, itdb_device_supports_podcast(device)));
    result.Set("supportsChapterImage", Napi::Boolean::New(env, itdb_device_supports_chapter_image(device)));

    // Device identification
    const Itdb_IpodInfo* ipodInfo = itdb_device_get_ipod_info(device);
    if (ipodInfo) {
        result.Set("generation", Napi::String::New(env, GenerationToString(ipodInfo->ipod_generation)));
        result.Set("model", Napi::String::New(env, ModelToString(ipodInfo->ipod_model)));
        result.Set("modelNumber", GcharToValue(env, ipodInfo->model_number));
        result.Set("modelName", Napi::String::New(env,
            itdb_info_get_ipod_model_name_string(ipodInfo->ipod_model) ?: "Unknown"));
    } else {
        result.Set("generation", Napi::String::New(env, "unknown"));
        result.Set("model", Napi::String::New(env, "unknown"));
        result.Set("modelNumber", env.Null());
        result.Set("modelName", Napi::String::New(env, "Unknown"));
    }

    return result;
}

Napi::Value DatabaseWrapper::GetSysInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!db_->device) {
        return env.Null();
    }

    // Check for required field argument
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Field name must be a string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string field = info[0].As<Napi::String>().Utf8Value();

    // Get the sysinfo value for the specified field
    gchar* value = itdb_device_get_sysinfo(db_->device, field.c_str());

    if (value) {
        Napi::String result = Napi::String::New(env, value);
        g_free(value);
        return result;
    }

    return env.Null();
}

Napi::Value DatabaseWrapper::SetSysInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!db_->device) {
        Napi::Error::New(env, "No device associated with database").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Check for required arguments
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Field name and value are required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Field name must be a string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string field = info[0].As<Napi::String>().Utf8Value();

    // Value can be string (to set) or null/undefined (to remove)
    if (info[1].IsNull() || info[1].IsUndefined()) {
        // Remove the field by setting value to NULL
        itdb_device_set_sysinfo(db_->device, field.c_str(), NULL);
    } else if (info[1].IsString()) {
        std::string value = info[1].As<Napi::String>().Utf8Value();
        itdb_device_set_sysinfo(db_->device, field.c_str(), value.c_str());
    } else {
        Napi::TypeError::New(env, "Value must be a string or null").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return env.Undefined();
}
