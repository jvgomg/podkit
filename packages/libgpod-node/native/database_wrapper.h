#pragma once

/**
 * DatabaseWrapper class declaration.
 * Wraps an Itdb_iTunesDB pointer for N-API.
 */

#include <napi.h>
#include <gpod/itdb.h>

class DatabaseWrapper : public Napi::ObjectWrap<DatabaseWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, Itdb_iTunesDB* db);
    DatabaseWrapper(const Napi::CallbackInfo& info);
    ~DatabaseWrapper();

    // Set the database pointer (called from Parse)
    void SetDatabase(Itdb_iTunesDB* db) { db_ = db; }

    // Get the database pointer (for use in operation files)
    Itdb_iTunesDB* GetDatabase() const { return db_; }

private:
    static Napi::FunctionReference constructor;
    Itdb_iTunesDB* db_;

    // Core database methods (database_wrapper.cc)
    Napi::Value GetInfo(const Napi::CallbackInfo& info);
    Napi::Value GetTracks(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylists(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
    Napi::Value GetMountpoint(const Napi::CallbackInfo& info);

    // Track operations (track_operations.cc)
    Napi::Value GetTrackById(const Napi::CallbackInfo& info);
    Napi::Value GetTrackByDbId(const Napi::CallbackInfo& info);
    Napi::Value AddTrack(const Napi::CallbackInfo& info);
    Napi::Value RemoveTrack(const Napi::CallbackInfo& info);
    Napi::Value CopyTrackToDevice(const Napi::CallbackInfo& info);
    Napi::Value UpdateTrack(const Napi::CallbackInfo& info);
    Napi::Value GetTrackFilePath(const Napi::CallbackInfo& info);
    Napi::Value DuplicateTrack(const Napi::CallbackInfo& info);

    // Artwork operations (artwork_operations.cc)
    Napi::Value SetTrackThumbnails(const Napi::CallbackInfo& info);
    Napi::Value SetTrackThumbnailsFromData(const Napi::CallbackInfo& info);
    Napi::Value RemoveTrackThumbnails(const Napi::CallbackInfo& info);
    Napi::Value HasTrackThumbnails(const Napi::CallbackInfo& info);
    Napi::Value GetUniqueArtworkIds(const Napi::CallbackInfo& info);
    Napi::Value GetArtworkFormats(const Napi::CallbackInfo& info);

    // Playlist operations (playlist_operations.cc)
    Napi::Value CreatePlaylist(const Napi::CallbackInfo& info);
    Napi::Value RemovePlaylist(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylistById(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylistByName(const Napi::CallbackInfo& info);
    Napi::Value SetPlaylistName(const Napi::CallbackInfo& info);
    Napi::Value AddTrackToPlaylist(const Napi::CallbackInfo& info);
    Napi::Value RemoveTrackFromPlaylist(const Napi::CallbackInfo& info);
    Napi::Value PlaylistContainsTrack(const Napi::CallbackInfo& info);
    Napi::Value GetPlaylistTracks(const Napi::CallbackInfo& info);

    // Device capability operations (database_wrapper.cc)
    Napi::Value GetDeviceCapabilities(const Napi::CallbackInfo& info);
    Napi::Value GetSysInfo(const Napi::CallbackInfo& info);
    Napi::Value SetSysInfo(const Napi::CallbackInfo& info);
};
