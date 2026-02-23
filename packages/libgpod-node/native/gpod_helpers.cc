/**
 * Helper functions for N-API to libgpod type conversions.
 */

#include "gpod_helpers.h"

Napi::Value GcharToValue(Napi::Env env, const gchar* str) {
    if (str == nullptr) {
        return env.Null();
    }
    return Napi::String::New(env, str);
}

gchar* ValueToGchar(const Napi::Value& value) {
    if (value.IsNull() || value.IsUndefined()) {
        return nullptr;
    }
    std::string str = value.As<Napi::String>().Utf8Value();
    return g_strdup(str.c_str());
}

int32_t GetOptionalInt32(const Napi::Object& obj, const char* key, int32_t defaultValue) {
    if (obj.Has(key) && !obj.Get(key).IsNull() && !obj.Get(key).IsUndefined()) {
        return obj.Get(key).As<Napi::Number>().Int32Value();
    }
    return defaultValue;
}

bool GetOptionalBool(const Napi::Object& obj, const char* key, bool defaultValue) {
    if (obj.Has(key) && !obj.Get(key).IsNull() && !obj.Get(key).IsUndefined()) {
        return obj.Get(key).As<Napi::Boolean>().Value();
    }
    return defaultValue;
}

gchar* GetOptionalString(const Napi::Object& obj, const char* key) {
    if (obj.Has(key)) {
        return ValueToGchar(obj.Get(key));
    }
    return nullptr;
}
