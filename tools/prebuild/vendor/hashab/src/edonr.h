#pragma once

#include <stdint.h>

enum { EDONR256_BLOCK_WORDS = 16 };

typedef struct {
  uint32_t hash[16];
} EdonR256State;

void EdonR256Init(EdonR256State* state);
void EdonR256Compress(EdonR256State* state, const uint32_t block[static EDONR256_BLOCK_WORDS]);
