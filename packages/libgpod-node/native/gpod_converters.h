#pragma once

/**
 * Enum-to-string and object conversion functions for libgpod types.
 */

#include <napi.h>
#include <gpod/itdb.h>

// Convert Itdb_IpodGeneration to string
const char* GenerationToString(Itdb_IpodGeneration gen);

// Convert Itdb_IpodModel to string
const char* ModelToString(Itdb_IpodModel model);

// Convert device info to JS object
Napi::Object DeviceInfoToObject(Napi::Env env, const Itdb_Device* device);

// Convert track to JS object
Napi::Object TrackToObject(Napi::Env env, const Itdb_Track* track);

// Convert playlist to JS object
Napi::Object PlaylistToObject(Napi::Env env, const Itdb_Playlist* pl);

// Convert smart playlist rule to JS object
Napi::Object SPLRuleToObject(Napi::Env env, const Itdb_SPLRule* rule);

// Convert smart playlist preferences to JS object
Napi::Object SPLPrefsToObject(Napi::Env env, const Itdb_SPLPref* prefs);

// Convert smart playlist to JS object (includes rules and prefs)
Napi::Object SmartPlaylistToObject(Napi::Env env, const Itdb_Playlist* pl);

// Parse SPL rule from JS object
void ObjectToSPLRule(Napi::Env env, Napi::Object obj, Itdb_SPLRule* rule);

// Parse SPL preferences from JS object
void ObjectToSPLPrefs(Napi::Env env, Napi::Object obj, Itdb_SPLPref* prefs);
