#pragma once
#include <stdint.h>

/**
 * calcHashAB - Main hash calculation function.
 *
 * @param target Output buffer (57 bytes)
 * @param sha1 Input SHA1 hash (20 bytes)
 * @param uuid Input UUID (8 bytes)
 * @param rnd_bytes Random bytes (23 bytes)
 */
void calcHashAB(uint8_t* target, const uint8_t* sha1, const uint8_t* uuid, const uint8_t* rnd_bytes);
