#pragma once

#include <stdint.h>

enum { HASHAB_HASH_WORK_SIZE = 64, HASHAB_HASH_OUTPUT_SIZE = 32 };

int hash(uint8_t work[HASHAB_HASH_WORK_SIZE], uint8_t output[HASHAB_HASH_OUTPUT_SIZE]);
