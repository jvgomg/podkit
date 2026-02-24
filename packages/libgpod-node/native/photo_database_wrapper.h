#pragma once

/**
 * PhotoDatabaseWrapper class declaration.
 * Wraps an Itdb_PhotoDB pointer for N-API.
 *
 * PhotoDB is a SEPARATE database from the iTunesDB (music database).
 * They can be opened and operated on independently.
 */

#include <napi.h>
#include <gpod/itdb.h>
#include <string>

class PhotoDatabaseWrapper : public Napi::ObjectWrap<PhotoDatabaseWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, Itdb_PhotoDB* db, const std::string& mountpoint = "");
    PhotoDatabaseWrapper(const Napi::CallbackInfo& info);
    ~PhotoDatabaseWrapper();

    // Set the database pointer (called from Parse/Create)
    void SetDatabase(Itdb_PhotoDB* db, const std::string& mountpoint = "") {
        db_ = db;
        mountpoint_ = mountpoint;
    }

    // Get the database pointer
    Itdb_PhotoDB* GetDatabase() const { return db_; }

private:
    static Napi::FunctionReference constructor;
    Itdb_PhotoDB* db_;
    std::string mountpoint_;

    // Core database methods
    Napi::Value GetInfo(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
    Napi::Value GetMountpoint(const Napi::CallbackInfo& info);
    Napi::Value SetMountpoint(const Napi::CallbackInfo& info);

    // Photo operations
    Napi::Value GetPhotos(const Napi::CallbackInfo& info);
    Napi::Value AddPhoto(const Napi::CallbackInfo& info);
    Napi::Value AddPhotoFromData(const Napi::CallbackInfo& info);
    Napi::Value RemovePhoto(const Napi::CallbackInfo& info);
    Napi::Value GetPhotoById(const Napi::CallbackInfo& info);

    // Photo album operations
    Napi::Value GetPhotoAlbums(const Napi::CallbackInfo& info);
    Napi::Value CreatePhotoAlbum(const Napi::CallbackInfo& info);
    Napi::Value RemovePhotoAlbum(const Napi::CallbackInfo& info);
    Napi::Value GetPhotoAlbumByName(const Napi::CallbackInfo& info);
    Napi::Value AddPhotoToAlbum(const Napi::CallbackInfo& info);
    Napi::Value RemovePhotoFromAlbum(const Napi::CallbackInfo& info);
    Napi::Value GetPhotoAlbumPhotos(const Napi::CallbackInfo& info);
    Napi::Value SetPhotoAlbumName(const Napi::CallbackInfo& info);

    // Device capability operations
    Napi::Value GetDeviceCapabilities(const Napi::CallbackInfo& info);
    Napi::Value SetSysInfo(const Napi::CallbackInfo& info);
};
