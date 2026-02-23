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
 */

#include <napi.h>
#include <gpod/itdb.h>
#include <string>

#include "database_wrapper.h"

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
 * Module initialization.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    DatabaseWrapper::Init(env, exports);

    exports.Set("parse", Napi::Function::New(env, Parse));
    exports.Set("getVersion", Napi::Function::New(env, GetVersion));

    return exports;
}

NODE_API_MODULE(gpod_binding, Init)
