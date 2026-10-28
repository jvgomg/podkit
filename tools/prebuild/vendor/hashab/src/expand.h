#pragma once

#include <stdint.h>

enum { HASHAB_EXPAND_SEED_SIZE = 24, HASHAB_EXPAND_OUTPUT_SIZE = 190 };

int expand(uint8_t output[HASHAB_EXPAND_OUTPUT_SIZE], const uint8_t ciphertext_at_20[HASHAB_EXPAND_SEED_SIZE], uint32_t selector, const uint8_t ciphertext_at_0[HASHAB_EXPAND_SEED_SIZE]);
