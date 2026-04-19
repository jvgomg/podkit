/**
 * N-API C++ bindings for libgpod.
 *
 * Main entry point and module initialization.
 * The implementation is split across multiple files:
 *   - gpod_helpers.cc: Type conversion helpers
 *   - gpod_converters.cc: Object conversion functions
 *   - database_wrapper.cc: Core database operations
 *   - track_operations.cc: Track CRUD methods
 *   - artwork_operations.cc: Artwork-related methods
 *   - playlist_operations.cc: Playlist methods
 *   - photo_database_wrapper.cc: Photo database operations
 */

#include <napi.h>
#include <gpod/itdb.h>
#include <string>
#include <cerrno>
#include <cstring>

#include "database_wrapper.h"
#include "photo_database_wrapper.h"

// Declaration for itdb_read_sysinfo_extended_from_usb from libgpod.
// USB SysInfoExtended reading — resolved at runtime via dlsym so the binding
// loads even when libgpod was built without HAVE_LIBUSB (e.g., system packages).
#include <dlfcn.h>
typedef gchar *(*ReadSysInfoExtendedFn)(guint bus_number, guint device_address);
static ReadSysInfoExtendedFn resolve_sysinfo_fn() {
    static ReadSysInfoExtendedFn fn = reinterpret_cast<ReadSysInfoExtendedFn>(
        dlsym(RTLD_DEFAULT, "itdb_read_sysinfo_extended_from_usb"));
    return fn;
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
 * Parse an iPod database from a specific file path.
 * Unlike parse(), this reads a database file directly without
 * requiring a full iPod mount point structure.
 * @param filename Path to iTunesDB file
 * @returns Database object
 */
Napi::Value ParseFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected filename path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string filename = info[0].As<Napi::String>().Utf8Value();

    GError* error = nullptr;
    Itdb_iTunesDB* db = itdb_parse_file(filename.c_str(), &error);

    if (!db) {
        std::string message = error ? error->message : "Failed to parse database file";
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
 * Create a new empty iPod database.
 * The database is not associated with any mountpoint until
 * setMountpoint() is called.
 * @returns Database object
 */
Napi::Value Create(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Itdb_iTunesDB* db = itdb_new();

    if (!db) {
        Napi::Error::New(env, "Failed to create new database").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // IMPORTANT: Create a master playlist for the new database.
    // libgpod requires a master playlist for many operations (save, track add, etc.)
    // Without it, operations will fail with CRITICAL assertions like:
    //   - itdb_playlist_mpl: assertion 'pl' failed
    //   - prepare_itdb_for_write: assertion 'mpl' failed
    //   - mk_mhla: assertion 'fexp->albums' failed
    //   - mk_mhli: assertion 'fexp->artists' failed
    Itdb_Playlist* mpl = itdb_playlist_new("iPod", FALSE);
    if (mpl) {
        itdb_playlist_set_mpl(mpl);
        itdb_playlist_add(db, mpl, -1);
    }

    // Create a new DatabaseWrapper and set its internal pointer
    return DatabaseWrapper::NewInstance(env, db);
}

/**
 * Initialize a new iPod database on a mountpoint.
 * Creates the iPod_Control directory structure, SysInfo file,
 * and an empty iTunesDB ready for use.
 *
 * @param mountpoint Path to the iPod mount point (directory will be created if needed)
 * @param model Optional model number (e.g., "MA147" for iPod Video 60GB)
 * @param name Optional iPod name (default: "iPod")
 * @returns Database object for the newly initialized iPod
 */
Napi::Value InitIpod(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected mountpoint path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string mountpoint = info[0].As<Napi::String>().Utf8Value();

    // Default model: iPod Video 60GB (MA147) - good for testing with artwork/video support
    std::string model = "MA147";
    if (info.Length() >= 2 && info[1].IsString()) {
        model = info[1].As<Napi::String>().Utf8Value();
    }

    // Default name: "iPod"
    std::string name = "iPod";
    if (info.Length() >= 3 && info[2].IsString()) {
        name = info[2].As<Napi::String>().Utf8Value();
    }

    // Create directory if it doesn't exist
    if (g_mkdir_with_parents(mountpoint.c_str(), 0755) != 0) {
        std::string errmsg = "Failed to create mountpoint directory: ";
        errmsg += mountpoint;
        errmsg += " (";
        errmsg += std::strerror(errno);
        errmsg += ")";
        Napi::Error::New(env, errmsg).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Initialize the iPod structure
    GError* error = nullptr;
    gboolean success = itdb_init_ipod(mountpoint.c_str(), model.c_str(), name.c_str(), &error);

    if (!success) {
        std::string message = error ? error->message : "Failed to initialize iPod";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Parse the newly created database
    error = nullptr;
    Itdb_iTunesDB* db = itdb_parse(mountpoint.c_str(), &error);

    if (!db) {
        std::string message = error ? error->message : "Failed to parse newly created database";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

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
 * Parse a photo database from a mountpoint.
 * @param mountpoint Path to iPod mount point
 * @returns PhotoDatabase object
 */
Napi::Value ParsePhotoDb(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected mountpoint path").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string mountpoint = info[0].As<Napi::String>().Utf8Value();

    GError* error = nullptr;
    Itdb_PhotoDB* db = itdb_photodb_parse(mountpoint.c_str(), &error);

    if (!db) {
        std::string message = error ? error->message : "Failed to parse photo database";
        if (error) {
            g_error_free(error);
        }
        Napi::Error::New(env, message).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return PhotoDatabaseWrapper::NewInstance(env, db, mountpoint);
}

/**
 * Create a new empty photo database.
 * @param mountpoint Optional path to iPod mount point
 * @returns PhotoDatabase object
 */
Napi::Value CreatePhotoDb(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string mp_str;

    if (info.Length() >= 1 && info[0].IsString()) {
        mp_str = info[0].As<Napi::String>().Utf8Value();
    }

    Itdb_PhotoDB* db = itdb_photodb_create(mp_str.empty() ? nullptr : mp_str.c_str());

    if (!db) {
        Napi::Error::New(env, "Failed to create photo database").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return PhotoDatabaseWrapper::NewInstance(env, db, mp_str);
}

/**
 * Read SysInfoExtended XML from an iPod via USB vendor control transfer.
 * This is a standalone function that does not require an open database.
 *
 * @param busNumber USB bus number
 * @param deviceAddress USB device address
 * @returns XML string or null if the read fails
 */
Napi::Value ReadSysInfoExtendedFromUsb(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: busNumber, deviceAddress").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "busNumber and deviceAddress must be numbers").ThrowAsJavaScriptException();
        return env.Null();
    }

    unsigned int busNumber = info[0].As<Napi::Number>().Uint32Value();
    unsigned int deviceAddress = info[1].As<Napi::Number>().Uint32Value();

    ReadSysInfoExtendedFn fn = resolve_sysinfo_fn();
    if (!fn) {
        // libgpod was built without libusb support
        return env.Null();
    }

    gchar *xml = fn(busNumber, deviceAddress);

    if (xml == nullptr) {
        return env.Null();
    }

    Napi::String result = Napi::String::New(env, xml);
    g_free(xml);
    return result;
}

/**
 * Module initialization.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    DatabaseWrapper::Init(env, exports);
    PhotoDatabaseWrapper::Init(env, exports);

    exports.Set("parse", Napi::Function::New(env, Parse));
    exports.Set("parseFile", Napi::Function::New(env, ParseFile));
    exports.Set("create", Napi::Function::New(env, Create));
    exports.Set("initIpod", Napi::Function::New(env, InitIpod));
    exports.Set("getVersion", Napi::Function::New(env, GetVersion));

    // Photo database functions
    exports.Set("parsePhotoDb", Napi::Function::New(env, ParsePhotoDb));
    exports.Set("createPhotoDb", Napi::Function::New(env, CreatePhotoDb));

    // USB functions
    exports.Set("readSysInfoExtendedFromUsb", Napi::Function::New(env, ReadSysInfoExtendedFromUsb));

    return exports;
}

NODE_API_MODULE(gpod_binding, Init)
