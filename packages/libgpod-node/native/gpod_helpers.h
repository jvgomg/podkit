#pragma once

/**
 * Helper functions for N-API to libgpod type conversions.
 */

#include <napi.h>
#include <gpod/itdb.h>
#include <string>

// Convert gchar* to Napi::Value, handling NULL
Napi::Value GcharToValue(Napi::Env env, const gchar* str);

// Convert string value to gchar*, returns nullptr for null/undefined
gchar* ValueToGchar(const Napi::Value& value);

// Get optional number with default
int32_t GetOptionalInt32(const Napi::Object& obj, const char* key, int32_t defaultValue);

// Get optional boolean with default
bool GetOptionalBool(const Napi::Object& obj, const char* key, bool defaultValue);

// Get optional string (caller owns returned gchar*)
gchar* GetOptionalString(const Napi::Object& obj, const char* key);
