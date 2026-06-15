---
id: m-19
title: "VM Testing"
---

## Description

Test coverage that exercises podkit's device-discovery, doctor, and identification code paths against a controlled, synthetic device matrix. Scope is what to test and which permutations to cover. The VM infrastructure that produces those synthetic devices is planned separately — these tickets describe the desired test states (USB descriptors, on-disk file states, host environment states, etc.) at a black-box level.
