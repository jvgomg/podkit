/**
 * PhotoDatabaseWrapper implementation.
 * Provides N-API bindings for libgpod's PhotoDB functionality.
 *
 * PhotoDB is a SEPARATE database from the iTunesDB (music database).
 * Photos are stored as Itdb_Artwork structures.
 */

#include "photo_database_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"

Napi::FunctionReference PhotoDatabaseWrapper::constructor;

// Helper to convert Photo (Itdb_Artwork) to JS object
static Napi::Object PhotoToObject(Napi::Env env, const Itdb_Artwork* photo) {
    Napi::Object obj = Napi::Object::New(env);

    obj.Set("id", Napi::Number::New(env, photo->id));
    obj.Set("dbid", Napi::BigInt::New(env, static_cast<uint64_t>(photo->dbid)));
    obj.Set("rating", Napi::Number::New(env, photo->rating));
    obj.Set("creationDate", Napi::Number::New(env, static_cast<double>(photo->creation_date)));
    obj.Set("digitizedDate", Napi::Number::New(env, static_cast<double>(photo->digitized_date)));
    obj.Set("artworkSize", Napi::Number::New(env, photo->artwork_size));

    return obj;
}

// Helper to convert PhotoAlbum to JS object
static Napi::Object PhotoAlbumToObject(Napi::Env env, const Itdb_PhotoAlbum* album) {
    Napi::Object obj = Napi::Object::New(env);

    obj.Set("id", Napi::Number::New(env, album->album_id));
    obj.Set("name", GcharToValue(env, album->name));
    obj.Set("albumType", Napi::Number::New(env, album->album_type));
    obj.Set("isPhotoLibrary", Napi::Boolean::New(env, album->album_type == 1));
    obj.Set("photoCount", Napi::Number::New(env, g_list_length(album->members)));

    // Slideshow settings
    obj.Set("playMusic", Napi::Boolean::New(env, album->playmusic != 0));
    obj.Set("repeat", Napi::Boolean::New(env, album->repeat != 0));
    obj.Set("random", Napi::Boolean::New(env, album->random != 0));
    obj.Set("showTitles", Napi::Boolean::New(env, album->show_titles != 0));
    obj.Set("transitionDirection", Napi::Number::New(env, album->transition_direction));
    obj.Set("slideDuration", Napi::Number::New(env, album->slide_duration));
    obj.Set("transitionDuration", Napi::Number::New(env, album->transition_duration));
    obj.Set("songId", Napi::BigInt::New(env, static_cast<uint64_t>(album->song_id)));

    return obj;
}

Napi::Object PhotoDatabaseWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "PhotoDatabase", {
        // Core methods
        InstanceMethod("getInfo", &PhotoDatabaseWrapper::GetInfo),
        InstanceMethod("write", &PhotoDatabaseWrapper::Write),
        InstanceMethod("close", &PhotoDatabaseWrapper::Close),
        InstanceMethod("getMountpoint", &PhotoDatabaseWrapper::GetMountpoint),
        InstanceMethod("setMountpoint", &PhotoDatabaseWrapper::SetMountpoint),

        // Photo methods
        InstanceMethod("getPhotos", &PhotoDatabaseWrapper::GetPhotos),
        InstanceMethod("addPhoto", &PhotoDatabaseWrapper::AddPhoto),
        InstanceMethod("addPhotoFromData", &PhotoDatabaseWrapper::AddPhotoFromData),
        InstanceMethod("removePhoto", &PhotoDatabaseWrapper::RemovePhoto),
        InstanceMethod("getPhotoById", &PhotoDatabaseWrapper::GetPhotoById),

        // Photo album methods
        InstanceMethod("getPhotoAlbums", &PhotoDatabaseWrapper::GetPhotoAlbums),
        InstanceMethod("createPhotoAlbum", &PhotoDatabaseWrapper::CreatePhotoAlbum),
        InstanceMethod("removePhotoAlbum", &PhotoDatabaseWrapper::RemovePhotoAlbum),
        InstanceMethod("getPhotoAlbumByName", &PhotoDatabaseWrapper::GetPhotoAlbumByName),
        InstanceMethod("addPhotoToAlbum", &PhotoDatabaseWrapper::AddPhotoToAlbum),
        InstanceMethod("removePhotoFromAlbum", &PhotoDatabaseWrapper::RemovePhotoFromAlbum),
        InstanceMethod("getPhotoAlbumPhotos", &PhotoDatabaseWrapper::GetPhotoAlbumPhotos),
        InstanceMethod("setPhotoAlbumName", &PhotoDatabaseWrapper::SetPhotoAlbumName),

        // Device capability methods
        InstanceMethod("getDeviceCapabilities", &PhotoDatabaseWrapper::GetDeviceCapabilities),
        InstanceMethod("setSysInfo", &PhotoDatabaseWrapper::SetSysInfo),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("PhotoDatabase", func);
    return exports;
}

Napi::Object PhotoDatabaseWrapper::NewInstance(Napi::Env env, Itdb_PhotoDB* db, const std::string& mountpoint) {
    Napi::Object wrapper = constructor.New({});
    PhotoDatabaseWrapper* unwrapped = Napi::ObjectWrap<PhotoDatabaseWrapper>::Unwrap(wrapper);
    unwrapped->SetDatabase(db, mountpoint);
    return wrapper;
}

PhotoDatabaseWrapper::PhotoDatabaseWrapper(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PhotoDatabaseWrapper>(info), db_(nullptr), mountpoint_() {
    // Constructor is called from JS but database is set via NewInstance()
}

PhotoDatabaseWrapper::~PhotoDatabaseWrapper() {
    if (db_) {
        itdb_photodb_free(db_);
        db_ = nullptr;
    }
}

Napi::Value PhotoDatabaseWrapper::GetInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);

    result.Set("mountpoint", mountpoint_.empty() ?
        env.Null() :
        Napi::String::New(env, mountpoint_));
    result.Set("photoCount", Napi::Number::New(env, g_list_length(db_->photos)));
    result.Set("albumCount", Napi::Number::New(env, g_list_length(db_->photoalbums)));

    if (db_->device) {
        result.Set("device", DeviceInfoToObject(env, db_->device));
    } else {
        result.Set("device", env.Null());
    }

    return result;
}

Napi::Value PhotoDatabaseWrapper::Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    GError* error = nullptr;
    gboolean success = itdb_photodb_write(db_, &error);

    if (!success) {
        std::string message = error ? error->message : "Failed to write photo database";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value PhotoDatabaseWrapper::Close(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (db_) {
        itdb_photodb_free(db_);
        db_ = nullptr;
    }

    return env.Undefined();
}

Napi::Value PhotoDatabaseWrapper::GetMountpoint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (mountpoint_.empty()) {
        return env.Null();
    }

    return Napi::String::New(env, mountpoint_);
}

Napi::Value PhotoDatabaseWrapper::SetMountpoint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Mountpoint must be a string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string mountpoint = info[0].As<Napi::String>().Utf8Value();

    if (!db_->device) {
        // This shouldn't normally happen as itdb_photodb_create initializes device
        Napi::Error::New(env, "No device associated with photo database").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    itdb_device_set_mountpoint(db_->device, mountpoint.c_str());
    mountpoint_ = mountpoint;

    return env.Undefined();
}

Napi::Value PhotoDatabaseWrapper::GetPhotos(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = db_->photos; l != nullptr; l = l->next) {
        Itdb_Artwork* photo = static_cast<Itdb_Artwork*>(l->data);
        result.Set(index++, PhotoToObject(env, photo));
    }

    return result;
}

Napi::Value PhotoDatabaseWrapper::AddPhoto(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected image file path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string filename = info[0].As<Napi::String>().Utf8Value();

    // Optional position (-1 = append)
    gint position = -1;
    if (info.Length() >= 2 && info[1].IsNumber()) {
        position = info[1].As<Napi::Number>().Int32Value();
    }

    // Optional rotation (0, 90, 180, 270)
    gint rotation = 0;
    if (info.Length() >= 3 && info[2].IsNumber()) {
        rotation = info[2].As<Napi::Number>().Int32Value();
    }

    GError* error = nullptr;
    Itdb_Artwork* photo = itdb_photodb_add_photo(db_, filename.c_str(), position, rotation, &error);

    if (!photo) {
        std::string message = error ? error->message : "Failed to add photo";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return PhotoToObject(env, photo);
}

Napi::Value PhotoDatabaseWrapper::AddPhotoFromData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Expected image data buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    const guchar* data = buffer.Data();
    gsize data_len = buffer.Length();

    // Optional position (-1 = append)
    gint position = -1;
    if (info.Length() >= 2 && info[1].IsNumber()) {
        position = info[1].As<Napi::Number>().Int32Value();
    }

    // Optional rotation (0, 90, 180, 270)
    gint rotation = 0;
    if (info.Length() >= 3 && info[2].IsNumber()) {
        rotation = info[2].As<Napi::Number>().Int32Value();
    }

    GError* error = nullptr;
    Itdb_Artwork* photo = itdb_photodb_add_photo_from_data(db_, data, data_len, position, rotation, &error);

    if (!photo) {
        std::string message = error ? error->message : "Failed to add photo from data";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return PhotoToObject(env, photo);
}

Napi::Value PhotoDatabaseWrapper::RemovePhoto(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected photo id").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    guint32 photo_id = info[0].As<Napi::Number>().Uint32Value();

    // Find photo by ID
    Itdb_Artwork* found_photo = nullptr;
    for (GList* l = db_->photos; l != nullptr; l = l->next) {
        Itdb_Artwork* photo = static_cast<Itdb_Artwork*>(l->data);
        if (photo->id == photo_id) {
            found_photo = photo;
            break;
        }
    }

    if (!found_photo) {
        Napi::Error::New(env, "Photo not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Remove from all albums and database (album=NULL removes completely)
    itdb_photodb_remove_photo(db_, nullptr, found_photo);

    return env.Undefined();
}

Napi::Value PhotoDatabaseWrapper::GetPhotoById(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected photo id").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    guint32 photo_id = info[0].As<Napi::Number>().Uint32Value();

    for (GList* l = db_->photos; l != nullptr; l = l->next) {
        Itdb_Artwork* photo = static_cast<Itdb_Artwork*>(l->data);
        if (photo->id == photo_id) {
            return PhotoToObject(env, photo);
        }
    }

    return env.Null();
}

Napi::Value PhotoDatabaseWrapper::GetPhotoAlbums(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = db_->photoalbums; l != nullptr; l = l->next) {
        Itdb_PhotoAlbum* album = static_cast<Itdb_PhotoAlbum*>(l->data);
        result.Set(index++, PhotoAlbumToObject(env, album));
    }

    return result;
}

Napi::Value PhotoDatabaseWrapper::CreatePhotoAlbum(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected album name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();

    // Optional position (-1 = append)
    gint position = -1;
    if (info.Length() >= 2 && info[1].IsNumber()) {
        position = info[1].As<Napi::Number>().Int32Value();
    }

    Itdb_PhotoAlbum* album = itdb_photodb_photoalbum_create(db_, name.c_str(), position);

    if (!album) {
        Napi::Error::New(env, "Failed to create photo album").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return PhotoAlbumToObject(env, album);
}

Napi::Value PhotoDatabaseWrapper::RemovePhotoAlbum(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected album id").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gint32 album_id = info[0].As<Napi::Number>().Int32Value();

    // Optional: remove photos from database too (default: false)
    gboolean remove_pics = FALSE;
    if (info.Length() >= 2 && info[1].IsBoolean()) {
        remove_pics = info[1].As<Napi::Boolean>().Value() ? TRUE : FALSE;
    }

    // Find album by ID
    Itdb_PhotoAlbum* found_album = nullptr;
    for (GList* l = db_->photoalbums; l != nullptr; l = l->next) {
        Itdb_PhotoAlbum* album = static_cast<Itdb_PhotoAlbum*>(l->data);
        if (album->album_id == album_id) {
            found_album = album;
            break;
        }
    }

    if (!found_album) {
        Napi::Error::New(env, "Photo album not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Check if it's the Photo Library (type 1) - can't delete that
    if (found_album->album_type == 1) {
        Napi::Error::New(env, "Cannot delete Photo Library album").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    itdb_photodb_photoalbum_remove(db_, found_album, remove_pics);

    return env.Undefined();
}

Napi::Value PhotoDatabaseWrapper::GetPhotoAlbumByName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // NULL name returns the Photo Library (first album)
    const gchar* name = nullptr;
    std::string name_str;

    if (info.Length() >= 1 && info[0].IsString()) {
        name_str = info[0].As<Napi::String>().Utf8Value();
        name = name_str.c_str();
    }

    Itdb_PhotoAlbum* album = itdb_photodb_photoalbum_by_name(db_, name);

    if (!album) {
        return env.Null();
    }

    return PhotoAlbumToObject(env, album);
}

Napi::Value PhotoDatabaseWrapper::AddPhotoToAlbum(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected album id and photo id").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gint32 album_id = info[0].As<Napi::Number>().Int32Value();
    guint32 photo_id = info[1].As<Napi::Number>().Uint32Value();

    // Optional position (-1 = append)
    gint position = -1;
    if (info.Length() >= 3 && info[2].IsNumber()) {
        position = info[2].As<Napi::Number>().Int32Value();
    }

    // Find album by ID
    Itdb_PhotoAlbum* found_album = nullptr;
    for (GList* l = db_->photoalbums; l != nullptr; l = l->next) {
        Itdb_PhotoAlbum* album = static_cast<Itdb_PhotoAlbum*>(l->data);
        if (album->album_id == album_id) {
            found_album = album;
            break;
        }
    }

    if (!found_album) {
        Napi::Error::New(env, "Photo album not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Find photo by ID
    Itdb_Artwork* found_photo = nullptr;
    for (GList* l = db_->photos; l != nullptr; l = l->next) {
        Itdb_Artwork* photo = static_cast<Itdb_Artwork*>(l->data);
        if (photo->id == photo_id) {
            found_photo = photo;
            break;
        }
    }

    if (!found_photo) {
        Napi::Error::New(env, "Photo not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    itdb_photodb_photoalbum_add_photo(db_, found_album, found_photo, position);

    return PhotoAlbumToObject(env, found_album);
}

Napi::Value PhotoDatabaseWrapper::RemovePhotoFromAlbum(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected album id and photo id").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gint32 album_id = info[0].As<Napi::Number>().Int32Value();
    guint32 photo_id = info[1].As<Napi::Number>().Uint32Value();

    // Find album by ID
    Itdb_PhotoAlbum* found_album = nullptr;
    for (GList* l = db_->photoalbums; l != nullptr; l = l->next) {
        Itdb_PhotoAlbum* album = static_cast<Itdb_PhotoAlbum*>(l->data);
        if (album->album_id == album_id) {
            found_album = album;
            break;
        }
    }

    if (!found_album) {
        Napi::Error::New(env, "Photo album not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Find photo by ID
    Itdb_Artwork* found_photo = nullptr;
    for (GList* l = db_->photos; l != nullptr; l = l->next) {
        Itdb_Artwork* photo = static_cast<Itdb_Artwork*>(l->data);
        if (photo->id == photo_id) {
            found_photo = photo;
            break;
        }
    }

    if (!found_photo) {
        Napi::Error::New(env, "Photo not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Passing a specific album removes only from that album, not from database
    itdb_photodb_remove_photo(db_, found_album, found_photo);

    return PhotoAlbumToObject(env, found_album);
}

Napi::Value PhotoDatabaseWrapper::GetPhotoAlbumPhotos(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected album id").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gint32 album_id = info[0].As<Napi::Number>().Int32Value();

    // Find album by ID
    Itdb_PhotoAlbum* found_album = nullptr;
    for (GList* l = db_->photoalbums; l != nullptr; l = l->next) {
        Itdb_PhotoAlbum* album = static_cast<Itdb_PhotoAlbum*>(l->data);
        if (album->album_id == album_id) {
            found_album = album;
            break;
        }
    }

    if (!found_album) {
        Napi::Error::New(env, "Photo album not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = found_album->members; l != nullptr; l = l->next) {
        Itdb_Artwork* photo = static_cast<Itdb_Artwork*>(l->data);
        result.Set(index++, PhotoToObject(env, photo));
    }

    return result;
}

Napi::Value PhotoDatabaseWrapper::SetPhotoAlbumName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected album id and new name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gint32 album_id = info[0].As<Napi::Number>().Int32Value();
    std::string new_name = info[1].As<Napi::String>().Utf8Value();

    // Find album by ID
    Itdb_PhotoAlbum* found_album = nullptr;
    for (GList* l = db_->photoalbums; l != nullptr; l = l->next) {
        Itdb_PhotoAlbum* album = static_cast<Itdb_PhotoAlbum*>(l->data);
        if (album->album_id == album_id) {
            found_album = album;
            break;
        }
    }

    if (!found_album) {
        Napi::Error::New(env, "Photo album not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Free old name and set new one
    g_free(found_album->name);
    found_album->name = g_strdup(new_name.c_str());

    return PhotoAlbumToObject(env, found_album);
}

Napi::Value PhotoDatabaseWrapper::GetDeviceCapabilities(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);

    if (!db_->device) {
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

    result.Set("supportsArtwork", Napi::Boolean::New(env, itdb_device_supports_artwork(device)));
    result.Set("supportsVideo", Napi::Boolean::New(env, itdb_device_supports_video(device)));
    result.Set("supportsPhoto", Napi::Boolean::New(env, itdb_device_supports_photo(device)));
    result.Set("supportsPodcast", Napi::Boolean::New(env, itdb_device_supports_podcast(device)));
    result.Set("supportsChapterImage", Napi::Boolean::New(env, itdb_device_supports_chapter_image(device)));

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

Napi::Value PhotoDatabaseWrapper::SetSysInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "PhotoDatabase not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!db_->device) {
        Napi::Error::New(env, "No device associated with photo database").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Field name and value are required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Field name must be a string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string field = info[0].As<Napi::String>().Utf8Value();

    if (info[1].IsNull() || info[1].IsUndefined()) {
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
