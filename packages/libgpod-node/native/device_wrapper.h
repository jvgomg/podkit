#pragma once

/**
 * DeviceWrapper class declaration.
 * Wraps an Itdb_Device pointer for standalone device capability queries
 * WITHOUT requiring an open iTunes database.
 *
 * Usage:
 *   Device.fromMountPoint("/Volumes/iPod")  → reads SysInfo, full capabilities
 *   Device.fromModelNumber("MA147")         → cached lookup, no filesystem
 */

#include <napi.h>
#include <gpod/itdb.h>

class DeviceWrapper : public Napi::ObjectWrap<DeviceWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    DeviceWrapper(const Napi::CallbackInfo& info);
    ~DeviceWrapper();

private:
    static Napi::FunctionReference constructor;
    Itdb_Device* device_;

    // Static factory methods
    static Napi::Value FromMountPoint(const Napi::CallbackInfo& info);
    static Napi::Value FromModelNumber(const Napi::CallbackInfo& info);

    // Instance methods
    Napi::Value GetCapabilities(const Napi::CallbackInfo& info);
    Napi::Value GetArtworkFormats(const Napi::CallbackInfo& info);
    Napi::Value GetSysInfo(const Napi::CallbackInfo& info);
    Napi::Value GetInfo(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
};
