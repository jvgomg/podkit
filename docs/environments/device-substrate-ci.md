# Device substrate (CI conformance backstop)

A **throwaway device substrate booted on a GitHub Actions runner**, used by
`.github/workflows/substrate-conformance.yml` to prove that
`substrate-doctor.sh` is satisfiable by a machine nobody in this project owns.

Not a third supported provisioner. doc-060 puts "provisioner support beyond
Proxmox and Lima as shipped recipes" out of scope, and this does not change
that: the QEMU bring-up exists because the conformance check needs a substrate
somewhere, nothing in the harness targets it, and no test runs against it. It is
written as plain bash with no CI in it only so that a CI failure can be
reproduced by hand — not as an invitation to adopt it.

Written as a change log rather than prose so it can be lifted into automation.
Every step is idempotent, and the Steps section below is automated end to end —
the workflow *is* those steps executed. The Preconditions are the exception and
are marked as such: they are what to check by hand when a run fails, not
assertions anything performs.

A substrate is not "a Proxmox VM" and not "a CI runner". It is any SSH-reachable
Debian box that passes `substrate-doctor.sh`. See
[ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md) and
[CONTEXT.md](../../CONTEXT.md) §Test environments.

---

## What this is for — and what it is not

This is a **backstop** in the sense [CONTEXT.md](../../CONTEXT.md) defines: it is
judged on what it stops from escaping, never on being the place work gets
verified. Specifically, it stops the substrate contract from quietly becoming
"whatever one maintainer's box happens to be", which is the failure mode a
contract satisfied by exactly two hand-built machines is one bad merge away
from.

It verifies **no podkit behaviour at all**. Nothing merges or fails to merge on
it, and it is deliberately absent from `ci.yml`'s `ci-passed` aggregate. The
test backstop is `ci.yml`; the gate is `bun run quality`.

---

## Findings: a stock hosted runner is not a substrate

[ADR-028 §6](../adr/adr-028-substrate-agnostic-device-harness.md) states that
"`usb-synth` on CI is technically reachable — GitHub runners are full VMs that
can `modprobe dummy_hcd`", and task-516 was written on that premise. **The
premise does not hold.**

Measured on `ubuntu-24.04` image `20260907.300.1`, kernel `6.17.0-1022-azure`
(run 35840127746): **15 of the contract's assertions fail**. The `premise` job
re-asserts them every run, so this section is a standing claim rather than a
remembered one, and it flips on its own if any of them stops being true.

- **Ubuntu does not build `dummy_hcd`.** `modinfo dummy_hcd` reports *Module not
  found* and `/sys/class/udc` is absent, so the runner offers **0 UDC slots**
  where the contract needs four. `CONFIG_USB_DUMMY_HCD` is not enabled in any
  Ubuntu kernel flavour, so no `linux-modules-extra-*` package carries it. This
  is a property of Ubuntu's kernel config, not of the runner being virtualised
  or restricted — the runner *is* a full VM, and that turns out not to be the
  binding constraint. Same finding as the PVE host's in the Proxmox playbook,
  for the same reason, and it is why every substrate is a **Debian** guest.
- **The base OS assertion fails too.** `/etc/debian_version` reads `trixie/sid`
  — the Debian branch Ubuntu forked from, never `12.x` — so the contract's hard
  major-version assertion rejects the box before it reaches the modules.
- **Both negative assertions fire.** `node` and `npm` are on `PATH` at
  `/usr/local/bin`, and 47 `-dev`/toolchain packages are installed, from
  `libc6-dev` and `pkg-config` through three parallel LLVM and GCC toolchains.
  That is not a defect in the image — it exists to build software. It is the
  clearest possible demonstration that "a machine that can build podkit" and "a
  machine that can prove podkit's binary needs nothing to run" are different
  machines.

  One prediction of this document was wrong and the run corrected it: `bun` is
  *not* on a hosted runner (`ok  no bun on PATH`). podkit's own `ci.yml`
  installs it through mise, so it is easy to assume the image ships it. Left in
  rather than quietly fixed, because it is the argument for the `premise` job:
  three of these four claims were right, and the one that was wrong was wrong in
  the direction of sounding more plausible.

### What the guest does, measured

Run 35840611601, the same workflow, same runner image. The Debian 12 guest
reached sshd in **15 seconds** and cloud-init in **30**; `provision-substrate.sh`
then took 42 seconds (almost all of it apt), and `substrate-doctor.sh` passed
**23 of 23** assertions — including `udc slots: 4 (need 4)`, which is the
assertion the host cannot satisfy at all. `debian major 12 (running 12.10)` with
no drift note, since the box is minutes old. Whole job: **2m54s**.

The negative half then failed exactly 3 assertions and named `npm`,
`build-essential` and `libc6-dev` among 13 packages. Worth recording that
`node` *did* appear at `/usr/bin/node` on bookworm after installing `npm`, so the
caution that kept it out of the required list turned out to be unnecessary here
— it stays out anyway, because the reason it was excluded (Debian has moved that
binary between packages across releases) is about future releases, not this one.

The consequence for this recipe: conformance is proven against a **Debian 12
guest booted on the runner**, not against the runner. Say that plainly wherever
it is claimed. The claim that survives is the one worth having — the contract is
satisfiable on hardware and a hypervisor this project does not own, by the same
two scripts the Lima and Proxmox paths run.

The consequence for `usb-synth` on CI: it is *not* blocked by the runner kernel
after all, because a Debian guest on the runner has `dummy_hcd`. ADR-028 leaves
that question open deliberately and task-516 does not close it — but the reason
to leave it open is now cost, not capability.

---

## Preconditions

Unlike the Steps below, **nothing checks these for you** — except the second row,
which `boot-substrate.sh` asserts. They are here because each one produces a
failure that does not name itself, so this is the list to walk by hand when a run
goes wrong.

| Assertion | Check | Required value | Asserted? |
|---|---|---|---|
| KVM is exposed | `ls -l /dev/kvm` | the node exists | no |
| KVM is usable by the job | `[ -w /dev/kvm ]` | writable after the udev rule | yes, by `boot-substrate.sh` |
| Egress to the Debian mirror | `curl -sI https://cloud.debian.org/` | HTTP 200 | no — surfaces as a curl failure in the boot step |
| The pinned image still exists | `curl -fsI "$SUBSTRATE_IMAGE_URL"` | HTTP 200 | no — same, and the likeliest cause after a Debian archive move |

The KVM one is the only one that has ever been the problem. Hosted runners
expose `/dev/kvm` but do not put the runner user in the `kvm` group, and a group
added with `usermod` does not apply to the shell already running — so the fix is
a udev rule, not a group change. `boot-substrate.sh` checks writability *before*
the 443 MB download so that this failure costs a second rather than a minute.

Falling back to software emulation when KVM is unavailable is deliberately not
done: a TCG boot takes minutes, which turns a missing permission into a slow job
instead of a clear error.

---

## Steps

### 1. Install QEMU and cloud-image-utils

```bash
sudo apt-get update -qq
sudo apt-get install -y -qq qemu-system-x86 qemu-utils cloud-image-utils
```

`cloud-image-utils` is what provides `cloud-localds`, which builds the NoCloud
seed image from the user-data.

Recommends are deliberately **not** stripped here, unlike everywhere else this
repo calls apt. `qemu-system-x86`'s firmware blobs move between Depends and
Recommends across releases, and a QEMU that cannot find a BIOS fails at boot
with a message that looks nothing like a missing package. The contract's
no-extra-packages rule is about the substrate, not about the machine driving it.

### 2. Grant the job access to `/dev/kvm`

```bash
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
  | sudo tee /etc/udev/rules.d/99-kvm4all.rules > /dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
```

### 3. Resolve the pinned image

```bash
SUBSTRATE_IMAGE_URL="$(bun -e 'import { substrateDebianImageUrl } from
  "./test-packages/substrate/src/debian-image.ts";
  console.log(substrateDebianImageUrl("amd64"))')"
```

Resolved rather than restated. `@podkit/substrate`'s `debian-image.ts` is the
single place the pinned Debian serial lives, and a literal URL in the workflow
would be a fourth copy of the pin — the exact drift that module was extracted to
kill. `debian-image.ts`'s only import is an `import type`, so `bun` transpiles it
away and this works with no `bun install`.

The `generic` flavour is load-bearing and comes with the constant: the
`genericcloud` flavour ships a trimmed kernel config without the gadget stack.

### 4. Boot the guest

```bash
SUBSTRATE_IMAGE_URL="$SUBSTRATE_IMAGE_URL" \
  test-packages/device-testing/substrate/ci/boot-substrate.sh
```

Renders `substrate/proxmox/cloud-init.user-data.yaml` — the *committed* template,
unmodified — against a freshly generated ephemeral ed25519 key, seeds it with
`cloud-localds`, and boots the image under QEMU with user-mode networking and
ssh forwarded to `127.0.0.1:2222`. Exercising that template is most of this
job's value beyond the doctor's exit code: it is otherwise only ever rendered by
hand on a PVE host, so a change that broke it would be found by the next person
to build a substrate rather than by CI.

Two details in that script are worth not re-deriving:

- **The disk is grown by 8 GiB.** The generic cloud image's virtual disk has well
  under a gigabyte free, and the contract's package set does not fit. apt reports
  the resulting failure as a dpkg error several hundred lines from the cause.
- **`cloud-init status --wait` is not optional.** The template sets
  `package_update: true`, so sshd answers while apt still holds the dpkg lock,
  and `provision-substrate.sh`'s first `apt-get update` would fail on the lock
  rather than on anything real.
- **The guest needs a qemu guest-agent channel**, even though nothing on the
  host talks to it. The template installs `qemu-guest-agent` and runs
  `systemctl enable --now` on it, because on Proxmox the host provides the
  virtio-serial port. Without
  `-device virtio-serial-pci` plus a `virtserialport` named
  `org.qemu.guest_agent.0`, the unit has nothing to bind, systemd waits out the
  device timeout, the `runcmd` fails and cloud-init ends in `status: error` —
  measured at 102 seconds of dead boot before the failure surfaced. Found by the
  first real run. Adding the channel is the right fix rather than trimming the
  template: the template is what the Proxmox path renders, and a CI run that
  only passes against a doctored copy proves nothing about the real file.

### 5. Apply and verify the substrate contract

```bash
test-packages/device-testing/substrate/ci/check-contract.sh
```

Copies the three contract scripts in and runs `sudo provision-substrate.sh`
followed by an unprivileged `substrate-doctor.sh`, requiring exit zero. The same
two steps, in the same order, that `harness:setup` runs against Lima and that
[the Proxmox playbook](./device-substrate-proxmox.md) runs by hand. That sameness
is the point — a step needed only here would be a contract clause only CI
satisfies.

### 6. Exercise the doctor's negative assertions

```bash
test-packages/device-testing/substrate/ci/assert-doctor-rejects.sh
```

**Destructive, and last.** Installs `build-essential` and `npm` on the now-
conforming box and requires the doctor to fail *and* to name `npm`,
`build-essential` and `libc6-dev`. The three names are chosen to cover both
negative code paths and both branches of the dpkg sweep: a forbidden command
found on `PATH`, a forbidden package matched by name, and a package matched by
the `-dev` suffix rule rather than by any list.

Asserting the names rather than the exit code is the whole exercise. A doctor
that fails with "something is wrong" satisfies an exit-code assertion while being
useless to whoever has to fix the box, and the negative half is the half that
never fires in normal use — nobody installs gcc on a substrate on purpose — so it
is the half most likely to have rotted unnoticed.

The script refuses to poison a box the doctor does not already pass. Without that
guard, a substrate failing for an unrelated reason would produce a non-zero exit
after poisoning and be reported as a working negative assertion.

A poisoned box is discarded, never repaired: a machine that has had a toolchain
on it can no longer vouch for the linkage claims the substrate exists to make.
On CI the runner is destroyed anyway, which is why this recipe is the natural
home for the check.

---

## Running it by hand

Every script above is plain bash with no CI in it, so the same sequence gives you
a throwaway substrate on any Linux box with KVM — useful for reproducing a CI
failure, or for getting a clean substrate without a hypervisor to hand:

```bash
export SUBSTRATE_WORK_DIR=/tmp/podkit-substrate
export SUBSTRATE_IMAGE_URL="$(bun -e 'import { substrateDebianImageUrl } from "./test-packages/substrate/src/debian-image.ts"; console.log(substrateDebianImageUrl("amd64"))')"
test-packages/device-testing/substrate/ci/boot-substrate.sh
test-packages/device-testing/substrate/ci/check-contract.sh
# optional, destructive:
test-packages/device-testing/substrate/ci/assert-doctor-rejects.sh
kill "$(cat "$SUBSTRATE_WORK_DIR/qemu.pid")"
```

Tear-down is that last line and nothing else, which is why the scripts do not
provide one.

`$SUBSTRATE_WORK_DIR/console.log` is the guest's serial console and is the only
evidence of a guest that never reached sshd. The workflow uploads it as an
artifact on failure — by name, never the whole directory, because the directory
also holds the ephemeral private key.

---

## Related

- [ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md) — substrate-agnostic device harness
- [device-substrate-proxmox.md](./device-substrate-proxmox.md) — the reference recipe this mirrors
- [linux-dev-host.md](./linux-dev-host.md) — the development box, itself unable to host a substrate
- `.github/workflows/substrate-conformance.yml` — the automated form of this document
- `.github/workflows/ci.yml` — the *test* backstop, which this is not
