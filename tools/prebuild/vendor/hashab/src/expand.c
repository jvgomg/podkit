#include "expand.h"

#include "byteorder.h"
#include "hash.h"

#include <stddef.h>
#include <stdint.h>

static void transform_hash_chunk(const uint8_t hash[32], uint8_t output[32]) {
  for (size_t i = 0; i < 8; i++) {
    uint32_t word = load32_le(hash + i * 4);
    uint32_t product = word * UINT32_C(0xc8180aff);
    uint32_t transformed = (uint32_t)(uint8_t)(word * UINT32_C(0x6b)) | (uint32_t)(uint8_t)((product >> 8) * UINT32_C(0x95)) << 8 | (uint32_t)(uint8_t)((product >> 16) * UINT32_C(0x95)) << 16 |
                           (uint32_t)(uint8_t)((product >> 24) * UINT32_C(0x95)) << 24;

    store32_le(output + i * 4, transformed);
  }
}

int expand(uint8_t output[190], const uint8_t ciphertext_at_20[24], uint32_t selector, const uint8_t ciphertext_at_0[24]) {
  uint8_t work[64] = {0};
  uint8_t digest[32];
  uint8_t chunk[32];

  if (output == NULL || ciphertext_at_20 == NULL || ciphertext_at_0 == NULL) {
    return -1;
  }

  if (selector * UINT32_C(0xb26ed57f) != 20) {
    return -1;
  }

  for (size_t i = 0; i < 24; i++) {
    work[i] = (uint8_t)(ciphertext_at_20[i] * UINT32_C(0x6f));
  }
  for (size_t i = 0; i < 20; i++) {
    work[24 + i] = (uint8_t)(ciphertext_at_0[i] * UINT32_C(0x6f));
  }

  store32_le(work + 48, 12);

  for (size_t iteration = 0; iteration < 6; iteration++) {
    size_t offset = iteration * sizeof(chunk);
    size_t remaining = 190 - offset;
    size_t copy_length = remaining < sizeof(chunk) ? remaining : sizeof(chunk);

    store32_le(work + 44, (uint32_t)iteration);
    if (hash(work, digest) != 0) {
      return -1;
    }
    transform_hash_chunk(digest, chunk);
    __builtin_memcpy(output + offset, chunk, copy_length);
  }

  return 0;
}
