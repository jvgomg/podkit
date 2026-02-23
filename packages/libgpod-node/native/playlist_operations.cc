/**
 * Playlist operations for DatabaseWrapper.
 */

#include "database_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"

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
