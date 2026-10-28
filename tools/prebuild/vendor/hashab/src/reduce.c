#include "reduce.h"

#include <stddef.h>
#include <stdint.h>

enum { REDUCE_INPUT_SIZE = 190, REDUCE_OUTPUT_SIZE = 16 };

static uint32_t rotate_left(uint32_t value, unsigned count) {
  return (value << count) | (value >> (32 - count));
}

static uint32_t rotate_left_or_ones(uint32_t value, unsigned count) {
  return count ? rotate_left(value, count) : UINT32_MAX;
}

static uint32_t rotate_right_or_ones(uint32_t value, unsigned count) {
  return count ? (value >> count) | (value << (32 - count)) : UINT32_MAX;
}

static uint32_t choose(uint32_t mask, uint32_t when_set, uint32_t when_clear) {
  return (mask & when_set) | (~mask & when_clear);
}

static uint32_t maj(uint32_t a, uint32_t b, uint32_t c) {
  return (a & b) | (a & c) | (b & c);
}

static uint8_t fold_word(uint32_t word) {
  uint8_t folded = (uint8_t)word;
  folded += (uint8_t)(word >> 8);
  folded ^= (uint8_t)(word >> 16);
  folded += (uint8_t)(word >> 24);
  return folded;
}

static const uint32_t key_seed[64] = {UINT32_C(0x5099fdb1), UINT32_C(0x9bbf4349), UINT32_C(0x5cd7686c), UINT32_C(0x92aebb6d), UINT32_C(0x2df36af2), UINT32_C(0x552f4079), UINT32_C(0x219dfeae), UINT32_C(0x343eb35a),
                                      UINT32_C(0x5dac0284), UINT32_C(0x91bae1f7), UINT32_C(0x64ec9d83), UINT32_C(0xa2ff04aa), UINT32_C(0x46df36ef), UINT32_C(0xd0d7ebdc), UINT32_C(0xf334c68d), UINT32_C(0x99a81ecf),
                                      UINT32_C(0x8a85f4e4), UINT32_C(0xb96ef2ae), UINT32_C(0x2e132f59), UINT32_C(0x91d1d6ee), UINT32_C(0x73628eaa), UINT32_C(0x7bfcd2c8), UINT32_C(0xcbc8db84), UINT32_C(0x2c358ebb),
                                      UINT32_C(0xcdce075f), UINT32_C(0x096dddf4), UINT32_C(0xf86bae65), UINT32_C(0xb408b83c), UINT32_C(0x3aa5ae3b), UINT32_C(0xef04fe54), UINT32_C(0xcbae433f), UINT32_C(0xbafb26c5),
                                      UINT32_C(0x546e42be), UINT32_C(0x694466f8), UINT32_C(0xc0141741), UINT32_C(0x51fb98d5), UINT32_C(0x6a53c93d), UINT32_C(0x784b88bc), UINT32_C(0xe689e637), UINT32_C(0x720cffaf),
                                      UINT32_C(0x3fb860f4), UINT32_C(0x1d78ec71), UINT32_C(0xa8a5ae0b), UINT32_C(0x6eeaa5b8), UINT32_C(0x4fd82294), UINT32_C(0xa61ea409), UINT32_C(0x3919851c), UINT32_C(0x577402c5),
                                      UINT32_C(0xe8b09ca2), UINT32_C(0x11676e33), UINT32_C(0xfa7fa4ec), UINT32_C(0x707bcd8d), UINT32_C(0x52c20d40), UINT32_C(0x734b0bfb), UINT32_C(0x744241ff), UINT32_C(0x089fb6e0),
                                      UINT32_C(0xe1cea850), UINT32_C(0xa91e1a9a), UINT32_C(0x9e9db0f3), UINT32_C(0x6fedd35b), UINT32_C(0xee066a04), UINT32_C(0x178a973a), UINT32_C(0x00aa4e6f), UINT32_C(0xf2994295)};

static const uint32_t state_seed[64] = {
    UINT32_C(0xf825e4f8), UINT32_C(0x202997a3), UINT32_C(0x65055cfe), UINT32_C(0xd588806b), UINT32_C(0x9a396a74), UINT32_C(0x210d95d7), UINT32_C(0x760fa7a5), UINT32_C(0x5b85496a),
    UINT32_C(0x65ad1cb7), UINT32_C(0xd93ce632), UINT32_C(0xb44bfe86), UINT32_C(0x97e5e021), UINT32_C(0x774af9ea), UINT32_C(0xfed3b7c5), UINT32_C(0x0d36b3e5), UINT32_C(0x7d7242ac),
    UINT32_C(0x648df3be), UINT32_C(0xfda267a7), UINT32_C(0x0abf3e91), UINT32_C(0xea9d68c3), UINT32_C(0xb9de0b6e), UINT32_C(0xd4b020aa), UINT32_C(0x2af3296f), UINT32_C(0xb5bd052c),
    UINT32_C(0xb0b3bf8e), UINT32_C(0x4b3d7bfe), UINT32_C(0xfd689550), UINT32_C(0xc3c8d629), UINT32_C(0xf1683297), UINT32_C(0x70e73403), UINT32_C(0x7b681b65), UINT32_C(0x4c566e07),
    UINT32_C(0x9d39df6e), UINT32_C(0x7ced44ca), UINT32_C(0xd85121e1), UINT32_C(0x8f89dab8), UINT32_C(0x49d5dcd4), UINT32_C(0x630a3cdd), UINT32_C(0xa43cd850), UINT32_C(0xe05011fa),
    UINT32_C(0xc79a3eb2), UINT32_C(0xe5912da3), UINT32_C(0x4683718c), UINT32_C(0xd0a154f1), UINT32_C(0x9c6aec15), UINT32_C(0x0e0d0468), UINT32_C(0x27de8990), UINT32_C(0x412adb3d),
    UINT32_C(0xf8775990), UINT32_C(0xe5e21243), UINT32_C(0xc753f819), UINT32_C(0x0663c6ef), UINT32_C(0x93c9d773), UINT32_C(0xab28ffff), UINT32_C(0x5204a510), UINT32_C(0x11a9d2c5),
    UINT32_C(0x6ec18106), UINT32_C(0x20ea572e), UINT32_C(0x6fe51b3a), UINT32_C(0x6e812c3d), UINT32_C(0x014b907b), UINT32_C(0x5c86830b), UINT32_C(0x9934a3d8), UINT32_C(0x3c57d8a8)};

static const uint32_t table[64] = {UINT32_C(0x3dd3c06d), UINT32_C(0x02eda8fb), UINT32_C(0xb82d5a58), UINT32_C(0xe4d2adec), UINT32_C(0x5c66b0d9), UINT32_C(0x5a4f2459), UINT32_C(0x08da381e), UINT32_C(0x35ba3a4c),
                                   UINT32_C(0xa86bb294), UINT32_C(0xfb7fc66a), UINT32_C(0xf53a25f2), UINT32_C(0x5dfe38f1), UINT32_C(0x6cb6b4af), UINT32_C(0xebeb4c63), UINT32_C(0x66209bd7), UINT32_C(0x29271b4e),
                                   UINT32_C(0x7a91205b), UINT32_C(0x7993f4f5), UINT32_C(0x8fb73ed6), UINT32_C(0x974262cd), UINT32_C(0xf47cab3b), UINT32_C(0x757b65cc), UINT32_C(0x92e55b93), UINT32_C(0xfa401668),
                                   UINT32_C(0xe8f42bcc), UINT32_C(0xa1796665), UINT32_C(0xc544210e), UINT32_C(0x4ff7d275), UINT32_C(0x1090b646), UINT32_C(0xad8b53cb), UINT32_C(0x7c871580), UINT32_C(0x67fb52d6),
                                   UINT32_C(0x5ae5b9a1), UINT32_C(0x69becb2c), UINT32_C(0xd2b974af), UINT32_C(0xb709f90d), UINT32_C(0x95671e5b), UINT32_C(0x2479e36e), UINT32_C(0x305facbd), UINT32_C(0xd7524214),
                                   UINT32_C(0xd7f29e79), UINT32_C(0x30cf42db), UINT32_C(0x86bad405), UINT32_C(0x370d4cb9), UINT32_C(0xaf348764), UINT32_C(0xc5ea190b), UINT32_C(0x06b2f0c7), UINT32_C(0x62ecaf33),
                                   UINT32_C(0x59f1cee3), UINT32_C(0xf7f35186), UINT32_C(0xf89d98cf), UINT32_C(0x1c9e3527), UINT32_C(0x31e62b5c), UINT32_C(0x89851e84), UINT32_C(0x9d67e93a), UINT32_C(0xec33dc26),
                                   UINT32_C(0x913bca92), UINT32_C(0x92f8982e), UINT32_C(0x5f160f82), UINT32_C(0x2691b03f), UINT32_C(0x433589fd), UINT32_C(0x18d97e1a), UINT32_C(0xba586b58), UINT32_C(0x8907cb75)};

int reduce(const uint8_t input[REDUCE_INPUT_SIZE], uint8_t output[REDUCE_OUTPUT_SIZE]) {
  uint32_t key[64];
  uint32_t state[64];
  uint32_t work[128];
  uint32_t s6, s7, s8, s9, s10, s18, s19, s21, s22, s24, s25, s26;

  if (input == NULL || output == NULL) {
    return -1;
  }

  __builtin_memcpy(key, key_seed, sizeof(key));
  __builtin_memcpy(state, state_seed, sizeof(state));

  for (size_t i = 0; i < 128; i++) {
    uint32_t word = 0;
    for (size_t byte = 0; byte < 4; byte++) {
      word |= (uint32_t)(uint8_t)(input[(4 * i + byte) % REDUCE_INPUT_SIZE] * UINT32_C(0xbd)) << (24 - 8 * byte);
    }
    work[i] = word;
  }

  for (size_t pass = 0; pass < 4; pass++) {
    for (size_t j = 0; j < 128; j++) {
      work[j] = (work[j] ^ rotate_left(work[(j - 13) & 127], 3)) + rotate_left(work[(j + 71) & 127], 5) - rotate_left(work[(j + 101) & 127], 23);
    }
  }

  s7 = (work[22] / 5) * UINT32_C(0xc3456f96);
  s8 = maj(state[60], table[63], UINT32_C(0x908d4d25)) / 3 + UINT32_C(0xef9695dd);
  key[42] += ((table[work[33] & 63] & UINT32_C(0x3cba9069)) + UINT32_C(0x43440114)) / 5;
  s9 = choose(state[26], state[work[87] & 63], ~UINT32_C(0x3cba9069));
  uint32_t rotation = rotate_left_or_ones(UINT32_C(0x6f72b2da), -state[work[55] & 63] & 31);
  uint32_t k = key[s7 & 63] / 5;
  uint32_t selected = choose(state[42], ~UINT32_C(0x3047874d), ~UINT32_C(0xb0dea603));
  s10 = rotation ^ UINT32_C(0x908d4d25);
  key[63] -= maj(selected, k, s7);
  state[25] += key[s7 & 63];
  state[60] = choose(key[21], s8, ~UINT32_C(0x1fb7d8d3)) * work[122];
  work[5] += choose(s7, ~UINT32_C(0xd36d6fb6), table[work[120] & 63]);

  key[35] += UINT32_C(0xb1a7e76f);
  s18 = key[s10 & 63] ^ UINT32_C(0x908d4d25);
  state[44] ^= 3 * choose(UINT32_C(0xc3456f96), table[29], table[work[18] & 63]);
  work[107] += state[work[44] & 63] + 1;
  uint32_t inverted_rotation = ~rotate_right_or_ones(UINT32_C(0xb0dea603), work[71] & 31);
  key[54] -= maj(state[29], inverted_rotation, ~UINT32_C(0x6f72b2da));
  work[62] ^= UINT32_C(0xdbd3d289);
  key[19] += state[s7 & 63] / 5 - maj(state[45], table[work[45] & 63], ~UINT32_C(0x4cf50fa3));
  key[49] = table[state[s18 & 63] * state[s18 & 63] & 63];
  key[21] ^= table[work[27] & 63];
  s19 = UINT32_C(0x908d4d24) - rotate_left_or_ones(UINT32_C(0x98b99bd8), state[60] * state[41] & 31);
  state[10] = work[73];
  key[20] ^= rotate_left_or_ones(~state[work[98] & 63], key[60] & 31);
  key[49] += choose(state[56], key[41], table[s19 & 63]) >> 1;
  uint32_t table_word = table[work[10] & 63];
  state[24] ^= choose(key[39], state[37], table_word * table_word * table_word);
  s6 = table[work[43] & 63] & ~UINT32_C(0x45059986);
  s6 = (s6 | UINT32_C(0x41050082)) ^ UINT32_C(0x3cba9069);
  uint32_t rotated = rotate_right_or_ones(~s18, table[work[31] & 63] & 31);
  state[13] ^= (key[work[50] & 63] & ~UINT32_C(0x147f3886)) | ~(rotated | UINT32_C(0xeb80c779));

  key[28] -= choose(key[35], maj(key[58], table[s9 & 63], UINT32_C(0x908d4d25)), ~key[29]);
  state[23] += ~maj(s8, state[work[106] & 63], UINT32_C(0x2725fe3b));
  state[24] ^= work[118] * work[118];
  key[35] ^= maj(state[54], 2 * work[108], state[41] * state[41] * state[41]);
  work[34] ^= choose(s18, state[work[39] & 63] ^ state[37], table[29] + UINT32_C(0x02e5a7e3));
  state[42] ^= choose(state[40], state[work[35] & 63], work[78] * work[78]);
  work[49] += 3 * key[work[39] & 63] + UINT32_C(0x62116be6);
  key[48] = s7;
  state[62] = key[s19 & 63] - state[work[93] & 63] - UINT32_C(0xef9695dd);
  key[55] += key[60] / 3 - state[work[112] & 63] / 3;
  s21 = maj(s6, table[60] + UINT32_C(0x4d485456), UINT32_C(0x41d44d69)) + UINT32_C(0x3cba9069);
  s25 = s9 ^ key[37];
  state[55] += UINT32_C(0x1d0f1b76);
  work[77] -= table[(state[60] & 127) >> 1];
  state[29] = key[work[68] & 63] / 15;
  state[46] ^= table[table[table[37] & 63] & 63];
  s22 = UINT32_C(0x4f2159fc) - maj(state[59], table[29], table[60] / 5);
  s24 = choose(UINT32_C(0xbd06dd88), maj(UINT32_C(0x59089be9), table[work[16] & 63], state[60]), table[60]) + UINT32_C(0x4f2159fc);
  work[10] = UINT32_C(0xde2849dd);
  work[8] += maj(choose(state[52], UINT32_C(0x908d4d25), UINT32_C(0x5987b420)), work[48] ^ s22, UINT32_C(0x51127d0f));
  state[20] += table[work[1] & 63];
  work[32] += 1 + rotate_right_or_ones(UINT32_C(0x0c7ad237), s22 * s22 * s22 & 31);
  state[4] -= choose(key[35], UINT32_C(0x4f2159fc), UINT32_C(0xc0540978)) | ~rotate_right_or_ones(UINT32_C(0x46ef99f4), key[41] & 31);
  state[60] = ~rotate_left_or_ones(~(work[62] / 3), (work[22] + key[work[93] & 63]) & 31);
  key[30] = UINT32_C(0x3cba9069);
  key[10] = ~(table[work[122] & 63] + UINT32_C(0x972da190));
  state[46] += maj(state[8], table[work[35] & 63] | table[41], UINT32_C(0xf3d39067));
  s26 = UINT32_C(0x3cba9069) - ((table[work[67] & 63] | table[work[120] & 63]) - table[work[98] & 63] - 1);
  uint32_t word = state[work[38] & 63] >> 1;
  state[17] ^= word * word * word;
  state[44] += table[62];
  key[26] -= table[s6 & 63];
  uint32_t first = choose(UINT32_C(0x313ec15d), key[s6 & 63], state[60]);
  uint32_t second = (table[work[79] & 63] & UINT32_C(0x7fbbd9fd)) | UINT32_C(0x0c201068);
  key[35] -= maj(key[34], first, second);
  key[16] ^= maj(state[43], work[27] >> 1, state[41] | state[37]);
  work[33] = UINT32_C(0x1c3e9665);
  key[58] -= work[118];
  state[21] += key[60];
  state[10] -= state[60];

  const uint8_t initial[REDUCE_OUTPUT_SIZE] = {
      (uint8_t)(UINT32_C(0xba) + s25),
      UINT8_C(0x97),
      UINT8_C(0x97),
      (uint8_t)(UINT32_C(0x9b) + s24),
      (uint8_t)(UINT32_C(0xba) + s8),
      UINT8_C(0x97),
      (uint8_t)(UINT32_C(0xd3) + s22),
      UINT8_C(0x97),
      (uint8_t)(UINT32_C(0xbe) + s18 + s6),
      (uint8_t)(UINT32_C(0x27) + s7),
      UINT8_C(0x4c),
      (uint8_t)(UINT32_C(0x27) + s19),
      (uint8_t)(UINT32_C(0xbe) + s10 + s21),
      (uint8_t)(UINT32_C(0xe3) + s26),
      UINT8_C(0x4c),
      (uint8_t)(UINT32_C(0x27) + work[92]),
  };

  for (size_t i = 0; i < REDUCE_OUTPUT_SIZE; i++) {
    uint8_t reduced = initial[i];
    for (size_t j = i; j < 64; j += REDUCE_OUTPUT_SIZE) {
      reduced ^= (uint8_t)key[j] ^ (uint8_t)state[j];
    }
    for (size_t j = i; j < 128; j += REDUCE_OUTPUT_SIZE) {
      reduced ^= fold_word(work[j]);
    }
    output[i] = (uint8_t)(UINT32_C(0xa5) * reduced);
  }

  return 0;
}
