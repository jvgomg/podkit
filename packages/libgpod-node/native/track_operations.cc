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

Napi::Value DatabaseWrapper::GetTrackByDbId(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected database ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t dbid = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    // libgpod doesn't have itdb_track_by_dbid, so we iterate manually
    for (GList* l = db_->tracks; l != nullptr; l = l->next) {
        Itdb_Track* track = static_cast<Itdb_Track*>(l->data);
        if (track->dbid == dbid) {
            return TrackToObject(env, track);
        }
    }

    return env.Null();
}

Napi::Value DatabaseWrapper::UpdateTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected track ID and fields object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected fields object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    Napi::Object fields = info[1].As<Napi::Object>();

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Update string fields (only if provided in the fields object)
    if (fields.Has("title")) {
        g_free(track->title);
        track->title = ValueToGchar(fields.Get("title"));
    }
    if (fields.Has("artist")) {
        g_free(track->artist);
        track->artist = ValueToGchar(fields.Get("artist"));
    }
    if (fields.Has("album")) {
        g_free(track->album);
        track->album = ValueToGchar(fields.Get("album"));
    }
    if (fields.Has("albumArtist")) {
        g_free(track->albumartist);
        track->albumartist = ValueToGchar(fields.Get("albumArtist"));
    }
    if (fields.Has("genre")) {
        g_free(track->genre);
        track->genre = ValueToGchar(fields.Get("genre"));
    }
    if (fields.Has("composer")) {
        g_free(track->composer);
        track->composer = ValueToGchar(fields.Get("composer"));
    }
    if (fields.Has("comment")) {
        g_free(track->comment);
        track->comment = ValueToGchar(fields.Get("comment"));
    }
    if (fields.Has("grouping")) {
        g_free(track->grouping);
        track->grouping = ValueToGchar(fields.Get("grouping"));
    }

    // Update numeric fields
    if (fields.Has("trackNumber") && fields.Get("trackNumber").IsNumber()) {
        track->track_nr = fields.Get("trackNumber").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("totalTracks") && fields.Get("totalTracks").IsNumber()) {
        track->tracks = fields.Get("totalTracks").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("discNumber") && fields.Get("discNumber").IsNumber()) {
        track->cd_nr = fields.Get("discNumber").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("totalDiscs") && fields.Get("totalDiscs").IsNumber()) {
        track->cds = fields.Get("totalDiscs").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("year") && fields.Get("year").IsNumber()) {
        track->year = fields.Get("year").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("duration") && fields.Get("duration").IsNumber()) {
        track->tracklen = fields.Get("duration").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("bitrate") && fields.Get("bitrate").IsNumber()) {
        track->bitrate = fields.Get("bitrate").As<Napi::Number>().Int32Value();
    }
    if (fields.Has("sampleRate") && fields.Get("sampleRate").IsNumber()) {
        track->samplerate = static_cast<guint16>(fields.Get("sampleRate").As<Napi::Number>().Int32Value());
    }
    if (fields.Has("size") && fields.Get("size").IsNumber()) {
        track->size = fields.Get("size").As<Napi::Number>().Uint32Value();
    }
    if (fields.Has("bpm") && fields.Get("bpm").IsNumber()) {
        track->BPM = static_cast<gint16>(fields.Get("bpm").As<Napi::Number>().Int32Value());
    }
    if (fields.Has("rating") && fields.Get("rating").IsNumber()) {
        track->rating = fields.Get("rating").As<Napi::Number>().Uint32Value();
    }
    if (fields.Has("playCount") && fields.Get("playCount").IsNumber()) {
        track->playcount = fields.Get("playCount").As<Napi::Number>().Uint32Value();
    }
    if (fields.Has("skipCount") && fields.Get("skipCount").IsNumber()) {
        track->skipcount = fields.Get("skipCount").As<Napi::Number>().Uint32Value();
    }
    if (fields.Has("mediaType") && fields.Get("mediaType").IsNumber()) {
        track->mediatype = fields.Get("mediaType").As<Napi::Number>().Uint32Value();
    }
    if (fields.Has("compilation") && fields.Get("compilation").IsBoolean()) {
        track->compilation = fields.Get("compilation").As<Napi::Boolean>().Value() ? 1 : 0;
    }

    // Update filetype
    if (fields.Has("filetype")) {
        g_free(track->filetype);
        track->filetype = ValueToGchar(fields.Get("filetype"));
    }

    // Update time_modified to now
    track->time_modified = time(nullptr);

    return TrackToObject(env, track);
}

Napi::Value DatabaseWrapper::GetTrackFilePath(const Napi::CallbackInfo& info) {
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

    // Use libgpod's itdb_filename_on_ipod to get the full path
    gchar* fullPath = itdb_filename_on_ipod(track);

    if (!fullPath) {
        // Track has no ipod_path or file doesn't exist
        return env.Null();
    }

    Napi::String result = Napi::String::New(env, fullPath);
    g_free(fullPath);

    return result;
}

Napi::Value DatabaseWrapper::DuplicateTrack(const Napi::CallbackInfo& info) {
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

    // Duplicate the track using libgpod
    Itdb_Track* newTrack = itdb_track_duplicate(track);
    if (!newTrack) {
        Napi::Error::New(env, "Failed to duplicate track").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Clear the ipod_path on the duplicate since it references the same file
    // The caller should copy a new file if needed
    g_free(newTrack->ipod_path);
    newTrack->ipod_path = nullptr;
    newTrack->transferred = FALSE;

    // Reset dbid - libgpod will assign a new one when adding to db
    newTrack->dbid = 0;
    newTrack->dbid2 = 0;

    // Set time_added to now
    newTrack->time_added = time(nullptr);
    newTrack->time_modified = newTrack->time_added;

    // Add to database at end (-1)
    itdb_track_add(db_, newTrack, -1);

    // Also add to master playlist
    Itdb_Playlist* mpl = itdb_playlist_mpl(db_);
    if (mpl) {
        itdb_playlist_add_track(mpl, newTrack, -1);
    }

    return TrackToObject(env, newTrack);
}
