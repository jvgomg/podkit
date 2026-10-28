#include "calcHashAB.h"

#include "cipher.h"
#include "expand.h"
#include "reduce.h"

#include <stddef.h>
#include <stdint.h>

enum { HASHAB_SIGNATURE_SIZE = 57, HASHAB_RANDOM_SIZE = 23 };

static const uint8_t permutation_32[32] = {0x06, 0x18, 0x11, 0x07, 0x13, 0x0d, 0x0e, 0x09, 0x15, 0x1d, 0x02, 0x1f, 0x01, 0x04, 0x1c, 0x1a,
                                           0x10, 0x14, 0x0b, 0x1e, 0x03, 0x0a, 0x1b, 0x19, 0x05, 0x0f, 0x16, 0x00, 0x12, 0x17, 0x08, 0x0c};

static const uint8_t permutation_56[56] = {0x15, 0x1c, 0x06, 0x0c, 0x07, 0x1a, 0x05, 0x13, 0x08, 0x19, 0x03, 0x01, 0x2d, 0x1e, 0x10, 0x31, 0x1d, 0x14, 0x28, 0x27, 0x35, 0x00, 0x2f, 0x1b, 0x26, 0x0b, 0x0e, 0x02,
                                           0x23, 0x17, 0x24, 0x22, 0x12, 0x1f, 0x20, 0x04, 0x29, 0x25, 0x21, 0x09, 0x18, 0x0d, 0x32, 0x0f, 0x11, 0x2e, 0x33, 0x2b, 0x30, 0x2a, 0x36, 0x0a, 0x2c, 0x34, 0x16, 0x37};

void calcHashAB(uint8_t* target, const uint8_t* sha1, const uint8_t* uuid, const uint8_t* rnd_bytes) {
  uint8_t stage1_input[80];
  uint8_t stage1_output[80];
  uint8_t expanded[190];
  uint8_t compression[16];
  uint8_t stage2_input[32];
  uint8_t stage2_output[32];
  if (target == NULL || sha1 == NULL || uuid == NULL || rnd_bytes == NULL) {
    return;
  }

  for (size_t i = 0; i < 8; i++) {
    stage1_input[i] = (uint8_t)(uuid[i] * 0xed);
  }
  for (size_t i = 0; i < 20; i++) {
    stage1_input[8 + i] = (uint8_t)(sha1[i] * 0xed);
  }
  for (size_t i = 0; i < HASHAB_RANDOM_SIZE; i++) {
    stage1_input[28 + i] = (uint8_t)(rnd_bytes[i] * 0xed);
  }
  __builtin_memset(stage1_input + 51, 0xc1, sizeof(stage1_input) - 51);

  if (stage1_cipher(stage1_output, stage1_input, sizeof(stage1_input)) != 0 || expand(expanded, stage1_output + 20, UINT32_C(0xaeba51ec), stage1_output) != 0 || reduce(expanded, compression) != 0) {
    __builtin_memset(target, 0, HASHAB_SIGNATURE_SIZE);
    return;
  }

  for (size_t i = 0; i < 32; i++) {
    stage2_input[i] = stage1_output[44 + permutation_32[i]];
  }

  if (stage2_cipher(stage2_output, stage2_input, sizeof(stage2_input), compression) != 0) {
    __builtin_memset(target, 0, HASHAB_SIGNATURE_SIZE);
    return;
  }

  target[0] = 3;
  target[1] = 0;
  for (size_t i = 0; i < 55; i++) {
    size_t source = permutation_56[i];
    target[i + 2] = source < HASHAB_RANDOM_SIZE ? rnd_bytes[source] : (uint8_t)(stage2_output[source - HASHAB_RANDOM_SIZE] * 0x2d);
  }
}
