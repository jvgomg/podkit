#pragma once

#include <stddef.h>
#include <stdint.h>

int stage1_cipher(uint8_t* output, const uint8_t* input, size_t length);

int stage2_cipher(uint8_t* output, const uint8_t* input, size_t length, const uint8_t iv[16]);
