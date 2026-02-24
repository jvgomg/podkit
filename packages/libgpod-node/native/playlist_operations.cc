/**
 * Playlist operations for DatabaseWrapper.
 */

#include "database_wrapper.h"
#include "gpod_helpers.h"
#include "gpod_converters.h"

Napi::Value DatabaseWrapper::CreatePlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected playlist name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();

    // Create a new regular playlist (not smart playlist)
    Itdb_Playlist* pl = itdb_playlist_new(name.c_str(), FALSE);
    if (!pl) {
        Napi::Error::New(env, "Failed to create playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Add to database at end (-1)
    itdb_playlist_add(db_, pl, -1);

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::RemovePlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Check if it's the master playlist - cannot delete it
    if (itdb_playlist_is_mpl(pl)) {
        Napi::Error::New(env, "Cannot delete the master playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    itdb_playlist_remove(pl);
    return env.Undefined();
}

Napi::Value DatabaseWrapper::GetPlaylistById(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        return env.Null();
    }

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::GetPlaylistByName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected playlist name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();

    Itdb_Playlist* pl = itdb_playlist_by_name(db_, const_cast<gchar*>(name.c_str()));
    if (!pl) {
        return env.Null();
    }

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::SetPlaylistName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and new name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsString()) {
        Napi::TypeError::New(env, "Expected new name as string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    std::string newName = info[1].As<Napi::String>().Utf8Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Free old name and set new one
    g_free(pl->name);
    pl->name = g_strdup(newName.c_str());

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::AddTrackToPlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t trackId = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Add track to playlist at end (-1)
    itdb_playlist_add_track(pl, track, -1);

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::RemoveTrackFromPlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t trackId = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Remove track from playlist
    itdb_playlist_remove_track(pl, track);

    return PlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::PlaylistContainsTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and track ID").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected track ID as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t trackId = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    if (!track) {
        Napi::Error::New(env, "Track not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    gboolean contains = itdb_playlist_contains_track(pl, track);
    return Napi::Boolean::New(env, contains != FALSE);
}

Napi::Value DatabaseWrapper::GetPlaylistTracks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = pl->members; l != nullptr; l = l->next) {
        Itdb_Track* track = static_cast<Itdb_Track*>(l->data);
        result.Set(index++, TrackToObject(env, track));
    }

    return result;
}

// ============================================================================
// Smart Playlist Operations
// ============================================================================

Napi::Value DatabaseWrapper::CreateSmartPlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected playlist name").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();

    // Create a new smart playlist (TRUE = is_spl)
    Itdb_Playlist* pl = itdb_playlist_new(name.c_str(), TRUE);
    if (!pl) {
        Napi::Error::New(env, "Failed to create smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Set default preferences (libgpod sets some defaults, but we ensure sane values)
    pl->splpref.liveupdate = TRUE;
    pl->splpref.checkrules = TRUE;
    pl->splpref.checklimits = FALSE;
    pl->splpref.limittype = 0x03; // ITDB_LIMITTYPE_SONGS
    pl->splpref.limitsort = 0x02; // ITDB_LIMITSORT_RANDOM
    pl->splpref.limitvalue = 25;
    pl->splpref.matchcheckedonly = FALSE;

    // Set default match operator
    pl->splrules.match_operator = 0; // ITDB_SPLMATCH_AND

    // Parse optional configuration object
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object config = info[1].As<Napi::Object>();

        // Match operator
        if (config.Has("match") && config.Get("match").IsNumber()) {
            pl->splrules.match_operator = config.Get("match").As<Napi::Number>().Uint32Value();
        }

        // Preferences
        if (config.Has("preferences") && config.Get("preferences").IsObject()) {
            ObjectToSPLPrefs(env, config.Get("preferences").As<Napi::Object>(), &pl->splpref);
        }

        // Rules
        if (config.Has("rules") && config.Get("rules").IsArray()) {
            Napi::Array rulesArray = config.Get("rules").As<Napi::Array>();

            // Clear default rule that libgpod adds
            while (pl->splrules.rules != nullptr) {
                Itdb_SPLRule* rule = static_cast<Itdb_SPLRule*>(pl->splrules.rules->data);
                itdb_splr_remove(pl, rule);
            }

            // Add new rules
            for (uint32_t i = 0; i < rulesArray.Length(); i++) {
                if (rulesArray.Get(i).IsObject()) {
                    Itdb_SPLRule* rule = itdb_splr_new();
                    ObjectToSPLRule(env, rulesArray.Get(i).As<Napi::Object>(), rule);
                    itdb_splr_add(pl, rule, -1);
                }
            }
        }
    }

    // Add to database at end (-1)
    itdb_playlist_add(db_, pl, -1);

    return SmartPlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::GetSmartPlaylistRules(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    for (GList* l = pl->splrules.rules; l != nullptr; l = l->next) {
        Itdb_SPLRule* rule = static_cast<Itdb_SPLRule*>(l->data);
        result.Set(index++, SPLRuleToObject(env, rule));
    }

    return result;
}

Napi::Value DatabaseWrapper::AddSmartPlaylistRule(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and rule object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected rule as object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Create and configure new rule
    Itdb_SPLRule* rule = itdb_splr_new();
    ObjectToSPLRule(env, info[1].As<Napi::Object>(), rule);

    // Add to playlist at end (-1)
    itdb_splr_add(pl, rule, -1);

    return SmartPlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::RemoveSmartPlaylistRule(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and rule index").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected rule index as number").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);
    uint32_t ruleIndex = info[1].As<Napi::Number>().Uint32Value();

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Find rule at index
    GList* ruleNode = g_list_nth(pl->splrules.rules, ruleIndex);
    if (!ruleNode) {
        Napi::Error::New(env, "Rule index out of range").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Itdb_SPLRule* rule = static_cast<Itdb_SPLRule*>(ruleNode->data);
    itdb_splr_remove(pl, rule);

    return SmartPlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::ClearSmartPlaylistRules(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Remove all rules
    while (pl->splrules.rules != nullptr) {
        Itdb_SPLRule* rule = static_cast<Itdb_SPLRule*>(pl->splrules.rules->data);
        itdb_splr_remove(pl, rule);
    }

    return SmartPlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::SetSmartPlaylistPreferences(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected playlist ID and preferences object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected preferences as object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    ObjectToSPLPrefs(env, info[1].As<Napi::Object>(), &pl->splpref);

    return SmartPlaylistToObject(env, pl);
}

Napi::Value DatabaseWrapper::GetSmartPlaylistPreferences(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return SPLPrefsToObject(env, &pl->splpref);
}

Napi::Value DatabaseWrapper::EvaluateSmartPlaylist(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!db_) {
        Napi::Error::New(env, "Database not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsBigInt()) {
        Napi::TypeError::New(env, "Expected playlist ID as BigInt").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool lossless;
    uint64_t playlistId = info[0].As<Napi::BigInt>().Uint64Value(&lossless);

    Itdb_Playlist* pl = itdb_playlist_by_id(db_, playlistId);
    if (!pl) {
        Napi::Error::New(env, "Playlist not found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!pl->is_spl) {
        Napi::Error::New(env, "Playlist is not a smart playlist").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Check if rules should be applied
    if (!pl->splpref.checkrules) {
        // Return empty array if rules are not checked
        return Napi::Array::New(env);
    }

    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;

    // Iterate through all tracks in the database
    for (GList* tl = db_->tracks; tl != nullptr; tl = tl->next) {
        Itdb_Track* track = static_cast<Itdb_Track*>(tl->data);

        // Evaluate all rules against this track
        bool matchesRules = false;
        bool hasRules = (pl->splrules.rules != nullptr);

        if (!hasRules) {
            // No rules = match all tracks
            matchesRules = true;
        } else if (pl->splrules.match_operator == 0) {
            // AND: All rules must match
            matchesRules = true;
            for (GList* rl = pl->splrules.rules; rl != nullptr; rl = rl->next) {
                Itdb_SPLRule* rule = static_cast<Itdb_SPLRule*>(rl->data);
                if (!itdb_splr_eval(rule, track)) {
                    matchesRules = false;
                    break;
                }
            }
        } else {
            // OR: Any rule can match
            matchesRules = false;
            for (GList* rl = pl->splrules.rules; rl != nullptr; rl = rl->next) {
                Itdb_SPLRule* rule = static_cast<Itdb_SPLRule*>(rl->data);
                if (itdb_splr_eval(rule, track)) {
                    matchesRules = true;
                    break;
                }
            }
        }

        if (matchesRules) {
            result.Set(index++, TrackToObject(env, track));
        }
    }

    // TODO: Apply limits if pl->splpref.checklimits is true
    // This would require sorting and truncating the result

    return result;
}
