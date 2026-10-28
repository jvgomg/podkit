/* edonr.c - an implementation of the EDON-R' 256 hash function
 *
 * Copyright (c) 2011, Aleksey Kravchenko <rhash.admin@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE  INCLUDING ALL IMPLIED WARRANTIES OF  MERCHANTABILITY
 * AND FITNESS.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT,  OR CONSEQUENTIAL DAMAGES  OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE,  DATA OR PROFITS,  WHETHER IN AN ACTION OF CONTRACT,  NEGLIGENCE
 * OR OTHER TORTIOUS ACTION,  ARISING OUT OF  OR IN CONNECTION  WITH THE USE  OR
 * PERFORMANCE OF THIS SOFTWARE.
 *
 * This implementation is based on the article:
 *    D. Gligoroski, R. S. Odegard, M. Mihova, S. J. Knapskog, ...,
 *    Cryptographic Hash Function EDON-R - Submission to NIST, 2008
 * with modifications from the article:
 *    D. Gligoroski, R. S. Odegard, M. Mihova, S. J. Knapskog, ...,
 *    Cryptographic Hash Function EDON-R - May 20, 2009
 *
 * EDON-R has been designed to be much more efficient than SHA-2
 * cryptographic hash functions, offering the same or better security.
 */

#include "edonr.h"

#define ROTL32(value, shift) (((value) << (shift)) | ((value) >> (32 - (shift))))

#define Q256(x0, x1, x2, x3, x4, x5, x6, x7, y0, y1, y2, y3, y4, y5, y6, y7, z0, z1, z2, z3, z4, z5, z6, z7) \
  {                                                                                                          \
    t8 = x0 + x4;                                                                                            \
    t9 = x1 + x7;                                                                                            \
    t12 = t8 + t9;                                                                                           \
    t10 = x2 + x3;                                                                                           \
    t11 = x5 + x6;                                                                                           \
    t13 = t10 + t11;                                                                                         \
    t0 = UINT32_C(0xaaaaaaaa) + t12 + x2;                                                                    \
    t1 = ROTL32(t12 + x3, 4);                                                                                \
    t2 = ROTL32(t12 + x6, 8);                                                                                \
    t3 = ROTL32(t13 + x7, 13);                                                                               \
    t4 = ROTL32(x1 + t13, 17);                                                                               \
    t5 = ROTL32(t8 + t10 + x5, 22);                                                                          \
    t6 = ROTL32(x0 + t9 + t11, 24);                                                                          \
    t7 = ROTL32(t13 + x4, 29);                                                                               \
    t16 = t0 ^ t4;                                                                                           \
    t17 = t1 ^ t7;                                                                                           \
    t18 = t2 ^ t3;                                                                                           \
    t19 = t5 ^ t6;                                                                                           \
    t8 = t3 ^ t19;                                                                                           \
    t9 = t2 ^ t19;                                                                                           \
    t10 = t18 ^ t5;                                                                                          \
    t11 = t16 ^ t1;                                                                                          \
    t12 = t16 ^ t7;                                                                                          \
    t13 = t17 ^ t6;                                                                                          \
    t14 = t18 ^ t4;                                                                                          \
    t15 = t0 ^ t17;                                                                                          \
    t16 = y0 + y1;                                                                                           \
    t17 = y2 + y5;                                                                                           \
    t20 = t16 + t17;                                                                                         \
    t18 = y3 + y4;                                                                                           \
    t22 = t16 + t18;                                                                                         \
    t19 = y6 + y7;                                                                                           \
    t21 = t18 + t19;                                                                                         \
    t23 = t17 + t19;                                                                                         \
    t0 = UINT32_C(0x55555555) + t20 + y7;                                                                    \
    t1 = ROTL32(t22 + y6, 5);                                                                                \
    t2 = ROTL32(t20 + y3, 9);                                                                                \
    t3 = ROTL32(y2 + t21, 11);                                                                               \
    t4 = ROTL32(t22 + y5, 15);                                                                               \
    t5 = ROTL32(t23 + y4, 20);                                                                               \
    t6 = ROTL32(y1 + t23, 25);                                                                               \
    t7 = ROTL32(y0 + t21, 27);                                                                               \
    t16 = t0 ^ t1;                                                                                           \
    t17 = t2 ^ t5;                                                                                           \
    t18 = t3 ^ t4;                                                                                           \
    t19 = t6 ^ t7;                                                                                           \
    z5 = t8 + (t18 ^ t6);                                                                                    \
    z6 = t9 + (t17 ^ t7);                                                                                    \
    z7 = t10 + (t4 ^ t19);                                                                                   \
    z0 = t11 + (t16 ^ t5);                                                                                   \
    z1 = t12 + (t2 ^ t19);                                                                                   \
    z2 = t13 + (t16 ^ t3);                                                                                   \
    z3 = t14 + (t0 ^ t18);                                                                                   \
    z4 = t15 + (t1 ^ t17);                                                                                   \
  }

void EdonR256Init(EdonR256State* state) {
  static const uint32_t initial_hash[16] = {UINT32_C(0x40414243), UINT32_C(0x44454647), UINT32_C(0x48494a4b), UINT32_C(0x4c4d4e4f), UINT32_C(0x50515253), UINT32_C(0x54555657),
                                            UINT32_C(0x58595a5b), UINT32_C(0x5c5d5e5f), UINT32_C(0x60616263), UINT32_C(0x64656667), UINT32_C(0x68696a6b), UINT32_C(0x6c6d6e6f),
                                            UINT32_C(0x70717273), UINT32_C(0x74757677), UINT32_C(0x78797a7b), UINT32_C(0x7c7d7e7f)};

  __builtin_memcpy(state->hash, initial_hash, sizeof(initial_hash));
}

void EdonR256Compress(EdonR256State* state, const uint32_t block[static EDONR256_BLOCK_WORDS]) {
  uint32_t* hash = state->hash;
  uint32_t t0, t1, t2, t3, t4, t5, t6, t7;
  uint32_t t8, t9, t10, t11, t12, t13, t14, t15;
  uint32_t t16, t17, t18, t19, t20, t21, t22, t23;
  uint32_t p16, p17, p18, p19, p20, p21, p22, p23;
  uint32_t p24, p25, p26, p27, p28, p29, p30, p31;

  Q256(block[15], block[14], block[13], block[12], block[11], block[10], block[9], block[8], block[0], block[1], block[2], block[3], block[4], block[5], block[6], block[7], p16, p17, p18, p19, p20, p21, p22, p23);
  Q256(p16, p17, p18, p19, p20, p21, p22, p23, block[8], block[9], block[10], block[11], block[12], block[13], block[14], block[15], p24, p25, p26, p27, p28, p29, p30, p31);

  Q256(hash[8], hash[9], hash[10], hash[11], hash[12], hash[13], hash[14], hash[15], p16, p17, p18, p19, p20, p21, p22, p23, p16, p17, p18, p19, p20, p21, p22, p23);
  Q256(p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p24, p25, p26, p27, p28, p29, p30, p31);

  Q256(p16, p17, p18, p19, p20, p21, p22, p23, hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7], p16, p17, p18, p19, p20, p21, p22, p23);
  Q256(p24, p25, p26, p27, p28, p29, p30, p31, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31);

  Q256(block[7], block[6], block[5], block[4], block[3], block[2], block[1], block[0], p16, p17, p18, p19, p20, p21, p22, p23, p16, p17, p18, p19, p20, p21, p22, p23);
  Q256(p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p24, p25, p26, p27, p28, p29, p30, p31);

  hash[0] ^= block[8] ^ p16;
  hash[1] ^= block[9] ^ p17;
  hash[2] ^= block[10] ^ p18;
  hash[3] ^= block[11] ^ p19;
  hash[4] ^= block[12] ^ p20;
  hash[5] ^= block[13] ^ p21;
  hash[6] ^= block[14] ^ p22;
  hash[7] ^= block[15] ^ p23;
  hash[8] ^= block[0] ^ p24;
  hash[9] ^= block[1] ^ p25;
  hash[10] ^= block[2] ^ p26;
  hash[11] ^= block[3] ^ p27;
  hash[12] ^= block[4] ^ p28;
  hash[13] ^= block[5] ^ p29;
  hash[14] ^= block[6] ^ p30;
  hash[15] ^= block[7] ^ p31;
}
