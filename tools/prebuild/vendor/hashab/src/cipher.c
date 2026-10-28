#include "cipher.h"

#include "byteorder.h"
#include "cipher_tables.h"

enum { HASHAB_BLOCK_SIZE = 16, HASHAB_AES128_ROUNDS = 10 };

static uint8_t affine_byte(const uint8_t parameters[HASHAB_ROUND_AFFINE_PARAMETERS], uint8_t value) {
  uint8_t result = parameters[0];

  for (size_t bit = 0; bit < 8; bit++) {
    if ((value & (uint8_t)(1 << bit)) != 0) {
      result ^= parameters[bit + 1u];
    }
  }
  return result;
}

static uint32_t profile_word(const cipher_profile* profile, size_t table_number, uint8_t index) {
  uint8_t base = profile->round_base[index];
  uint32_t word = 0;

  for (size_t byte = 0; byte < 4; byte++) {
    size_t lane = table_number * 4u + byte;
    uint8_t value = lane == 0 ? base : affine_byte(profile->round_affine[lane - 1u], base);

    word |= (uint32_t)value << (byte * 8u);
  }
  return word;
}

static void table_round(const cipher_profile* profile, const uint8_t input[HASHAB_BLOCK_SIZE], const uint8_t round_key[HASHAB_BLOCK_SIZE], uint8_t output[HASHAB_BLOCK_SIZE]) {
  for (size_t word = 0; word < 4; word++) {
    uint32_t value = load32_le(round_key + word * 4u);

    for (size_t table = 0; table < 4; table++) {
      value ^= profile_word(profile, table, input[(word * 4u + table * 5u) & 15u]);
    }
    store32_le(output + word * 4u, value);
  }
}

static void final_round(const cipher_profile* profile, const uint8_t input[HASHAB_BLOCK_SIZE], const uint8_t round_key[HASHAB_BLOCK_SIZE], uint8_t output[HASHAB_BLOCK_SIZE]) {
  for (size_t position = 0; position < HASHAB_BLOCK_SIZE; position++) {
    size_t input_position = ((position & 12u) + (position & 3u) * 5u) & 15u;
    uint8_t table_value = profile->final_map[input[input_position]];

    output[position] = (uint8_t)((uint32_t)table_value * UINT32_C(0x81) + UINT32_C(0x7a)) ^ round_key[position];
  }
}

static uint8_t inverse_map_byte(const uint8_t map[HASHAB_MAP_SIZE], uint8_t value) {
  for (size_t index = 0; index < HASHAB_MAP_SIZE; index++) {
    if (map[index] == value) {
      return (uint8_t)index;
    }
  }
  return 0;
}

static int cipher_cbc(const cipher_profile* profile, uint8_t* output, const uint8_t* input, size_t length, const uint8_t initial_chain[HASHAB_BLOCK_SIZE]) {
  uint8_t chaining[HASHAB_BLOCK_SIZE];
  uint8_t state[HASHAB_BLOCK_SIZE];
  uint8_t next[HASHAB_BLOCK_SIZE];

  if (profile == NULL || output == NULL || input == NULL || initial_chain == NULL || length == 0 || length % HASHAB_BLOCK_SIZE != 0) {
    return -1;
  }

  __builtin_memcpy(chaining, initial_chain, sizeof(chaining));

  for (size_t offset = 0; offset < length; offset += HASHAB_BLOCK_SIZE) {
    for (size_t position = 0; position < HASHAB_BLOCK_SIZE; position++) {
      state[position] = profile->input_map[input[offset + position]] ^ chaining[position] ^ profile->schedule[position];
    }

    for (size_t round = 1; round < HASHAB_AES128_ROUNDS; round++) {
      table_round(profile, state, profile->schedule + round * HASHAB_BLOCK_SIZE, next);
      __builtin_memcpy(state, next, sizeof(state));
    }

    final_round(profile, state, profile->schedule + HASHAB_AES128_ROUNDS * HASHAB_BLOCK_SIZE, next);

    for (size_t position = 0; position < HASHAB_BLOCK_SIZE; position++) {
      chaining[position] = next[position];
      output[offset + position] = profile->output_map[next[position]];
    }
  }

  return 0;
}

int stage1_cipher(uint8_t* output, const uint8_t* input, size_t length) {
  return cipher_cbc(&stage1_profile, output, input, length, stage1_initial_chain);
}

int stage2_cipher(uint8_t* output, const uint8_t* input, size_t length, const uint8_t iv[16]) {
  uint8_t initial_chain[HASHAB_BLOCK_SIZE];
  int result;

  if (iv == NULL) {
    return -1;
  }

  for (size_t position = 0; position < HASHAB_BLOCK_SIZE; position++) {
    initial_chain[position] = inverse_map_byte(stage2_profile.output_map, iv[position]);
  }

  result = cipher_cbc(&stage2_profile, output, input, length, initial_chain);

  return result;
}
