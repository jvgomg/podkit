/**
 * Artwork operations for DatabaseWrapper.
 */

#include "database_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"
#include <set>

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
