/**
 * DeviceWrapper implementation.
 * Standalone device handle for capability queries without opening a database.
 */

#include "device_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"

Napi::FunctionReference DeviceWrapper::constructor;

Napi::Object DeviceWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "Device", {
        // Instance methods
        InstanceMethod("getCapabilities", &DeviceWrapper::GetCapabilities),
        InstanceMethod("getArtworkFormats", &DeviceWrapper::GetArtworkFormats),
        InstanceMethod("getSysInfo", &DeviceWrapper::GetSysInfo),
        InstanceMethod("getInfo", &DeviceWrapper::GetInfo),
        InstanceMethod("close", &DeviceWrapper::Close),
        // Static factory methods
        StaticMethod("fromMountPoint", &DeviceWrapper::FromMountPoint),
        StaticMethod("fromModelNumber", &DeviceWrapper::FromModelNumber),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Device", func);
    return exports;
}

DeviceWrapper::DeviceWrapper(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<DeviceWrapper>(info), device_(nullptr) {
}

DeviceWrapper::~DeviceWrapper() {
    if (device_) {
        itdb_device_free(device_);
        device_ = nullptr;
    }
}

// =============================================================================
// Static factory methods
// =============================================================================

Napi::Value DeviceWrapper::FromMountPoint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Mount point path (string) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string mountPoint = info[0].As<Napi::String>().Utf8Value();

    Itdb_Device* device = itdb_device_new();
    if (!device) {
        Napi::Error::New(env, "Failed to create device handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // This reads SysInfo from the filesystem and determines capabilities
    itdb_device_set_mountpoint(device, mountPoint.c_str());

    // Create wrapper instance
    Napi::Object wrapper = constructor.New({});
    DeviceWrapper* obj = Napi::ObjectWrap<DeviceWrapper>::Unwrap(wrapper);
    obj->device_ = device;

    return wrapper;
}

Napi::Value DeviceWrapper::FromModelNumber(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Model number (string) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string modelNumber = info[0].As<Napi::String>().Utf8Value();

    Itdb_Device* device = itdb_device_new();
    if (!device) {
        Napi::Error::New(env, "Failed to create device handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Set model number directly in sysinfo — triggers capability lookup
    // without reading from filesystem
    itdb_device_set_sysinfo(device, "ModelNumStr", modelNumber.c_str());

    // Create wrapper instance
    Napi::Object wrapper = constructor.New({});
    DeviceWrapper* obj = Napi::ObjectWrap<DeviceWrapper>::Unwrap(wrapper);
    obj->device_ = device;

    return wrapper;
}

// =============================================================================
// Instance methods
// =============================================================================

Napi::Value DeviceWrapper::GetCapabilities(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!device_) {
        Napi::Error::New(env, "Device handle closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);

    // Capability flags
    result.Set("supportsArtwork", Napi::Boolean::New(env, itdb_device_supports_artwork(device_)));
    result.Set("supportsVideo", Napi::Boolean::New(env, itdb_device_supports_video(device_)));
    result.Set("supportsPhoto", Napi::Boolean::New(env, itdb_device_supports_photo(device_)));
    result.Set("supportsPodcast", Napi::Boolean::New(env, itdb_device_supports_podcast(device_)));
    result.Set("supportsChapterImage", Napi::Boolean::New(env, itdb_device_supports_chapter_image(device_)));

    // Device identification
    const Itdb_IpodInfo* ipodInfo = itdb_device_get_ipod_info(device_);
    if (ipodInfo) {
        result.Set("generation", Napi::String::New(env, GenerationToString(ipodInfo->ipod_generation)));
        result.Set("model", Napi::String::New(env, ModelToString(ipodInfo->ipod_model)));
        result.Set("modelNumber", GcharToValue(env, ipodInfo->model_number));
        result.Set("modelName", Napi::String::New(env,
            itdb_info_get_ipod_model_name_string(ipodInfo->ipod_model) ?: "Unknown"));
        result.Set("capacity", Napi::Number::New(env, ipodInfo->capacity));
    } else {
        result.Set("generation", Napi::String::New(env, "unknown"));
        result.Set("model", Napi::String::New(env, "unknown"));
        result.Set("modelNumber", env.Null());
        result.Set("modelName", Napi::String::New(env, "Unknown"));
        result.Set("capacity", Napi::Number::New(env, 0));
    }

    return result;
}

Napi::Value DeviceWrapper::GetArtworkFormats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!device_) {
        Napi::Error::New(env, "Device handle closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // itdb_device_get_cover_art_formats() is marked G_GNUC_INTERNAL in libgpod
    // and is not exported from the shared library. Artwork format dimensions
    // must be supplemented by the adapter layer using the generation ID.
    // This method is reserved for future use when ipod-db replaces libgpod.
    return Napi::Array::New(env, 0);
}

Napi::Value DeviceWrapper::GetSysInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!device_) {
        Napi::Error::New(env, "Device handle closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Field name (string) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string field = info[0].As<Napi::String>().Utf8Value();
    gchar* value = itdb_device_get_sysinfo(device_, field.c_str());

    if (!value) {
        return env.Null();
    }

    Napi::Value result = Napi::String::New(env, value);
    g_free(value);
    return result;
}

Napi::Value DeviceWrapper::GetInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!device_) {
        Napi::Error::New(env, "Device handle closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return DeviceInfoToObject(env, device_);
}

Napi::Value DeviceWrapper::Close(const Napi::CallbackInfo& info) {
    if (device_) {
        itdb_device_free(device_);
        device_ = nullptr;
    }
    return info.Env().Undefined();
}
