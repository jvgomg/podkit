/**
 * Track CRUD operations for DatabaseWrapper.
 */

#include "database_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"
#include <ctime>

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
