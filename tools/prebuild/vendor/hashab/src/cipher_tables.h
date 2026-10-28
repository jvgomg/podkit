#pragma once

#include <stdint.h>

enum { HASHAB_MAP_SIZE = 256, HASHAB_ROUND_AFFINE_COUNT = 15, HASHAB_ROUND_AFFINE_PARAMETERS = 9, HASHAB_SCHEDULE_SIZE = 176 };

typedef struct cipher_profile {
  uint8_t input_map[HASHAB_MAP_SIZE];
  uint8_t final_map[HASHAB_MAP_SIZE];
  uint8_t output_map[HASHAB_MAP_SIZE];
  uint8_t round_base[HASHAB_MAP_SIZE];
  uint8_t round_affine[HASHAB_ROUND_AFFINE_COUNT][HASHAB_ROUND_AFFINE_PARAMETERS];
  uint8_t schedule[HASHAB_SCHEDULE_SIZE];
} cipher_profile;

extern const cipher_profile stage1_profile;
extern const cipher_profile stage2_profile;

extern const uint8_t stage1_initial_chain[16];
