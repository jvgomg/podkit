/**
 * The pinned Debian cloud image, as one constant.
 *
 * ADR-016 requires the substrate's Debian point release to be pinned rather
 * than floated, so the kernel version and the module availability the device
 * harness depends on are reproducible. The pin was previously spelled out in
 * four places — three Lima YAMLs and the shell contract — held together by
 * comments telling the next person to bump all of them together. Comments do
 * not fail a build. This module does: `debian-image.test.ts` reads the YAMLs
 * and the shell contract back and asserts they agree with the values here, so
 * bumping one and forgetting the rest is a red test rather than a substrate
 * that boots a different kernel than its doctor was calibrated against.
 *
 * A YAML cannot read a TypeScript constant, so the YAMLs keep their literal
 * URLs and this module is the thing that knows they are supposed to match. The
 * bump procedure is: edit the values here, run the test, and fix every file it
 * names.
 *
 * @module
 */

import type { LimaVmId } from './registry.js';

/**
 * Debian major version the harness is built against. Asserted hard by
 * `substrate-doctor.sh`: the module names, package names and gadget stack the
 * contract declares are all bookworm's.
 */
export const SUBSTRATE_DEBIAN_MAJOR = '12';

/** Debian release codename, as it appears in the cloud-image URL path. */
export const SUBSTRATE_DEBIAN_SUITE = 'bookworm';

/**
 * Point release the pinned images ship.
 *
 * Reported as drift rather than asserted by the doctor: which qcow2 you booted
 * is a provisioning input, while the running point release moves under you with
 * any security update. A box that has taken an update has not broken the
 * contract.
 *
 * This and {@link SUBSTRATE_DEBIAN_IMAGE_SERIAL} are two facts about the same
 * image, and only Debian can say which serial carries which point release —
 * nothing here can check that for you. When bumping, read the point release off
 * the release notes for the serial you are moving to, not off memory.
 */
export const SUBSTRATE_DEBIAN_POINT_RELEASE = '12.10';

/**
 * Build serial of the pinned cloud image — the dated directory in the image
 * URL, which also appears in the filename. `latest` is deliberately NOT used
 * for the pinned substrates: it is a moving target, and a moving target is
 * exactly what ADR-016 refuses for anything whose kernel the harness depends
 * on.
 */
export const SUBSTRATE_DEBIAN_IMAGE_SERIAL = '20250316-2053';

/** Architectures Debian publishes the generic cloud image for, as it names them. */
export type DebianImageArch = 'amd64' | 'arm64';

/** Every architecture the pinned VMs declare an image for. */
export const DEBIAN_IMAGE_ARCHES: readonly DebianImageArch[] = ['arm64', 'amd64'];

/**
 * Lima's spelling of an architecture, for the `arch:` key that sits beside each
 * image URL. Debian's `amd64`/`arm64` and Lima's `x86_64`/`aarch64` name the
 * same two machines, and a YAML that paired the wrong two would download a
 * working image and then fail to boot it.
 */
export const LIMA_ARCH_BY_DEBIAN_ARCH: Readonly<Record<DebianImageArch, string>> = {
  amd64: 'x86_64',
  arm64: 'aarch64',
};

/** The pinned cloud-image URL for one architecture. */
export function substrateDebianImageUrl(arch: DebianImageArch): string {
  const serial = SUBSTRATE_DEBIAN_IMAGE_SERIAL;
  return (
    `https://cloud.debian.org/images/cloud/${SUBSTRATE_DEBIAN_SUITE}/${serial}/` +
    `debian-${SUBSTRATE_DEBIAN_MAJOR}-generic-${arch}-${serial}.qcow2`
  );
}

/**
 * The Lima substrates whose images are pinned to the exact serial, and which
 * must therefore all move together.
 *
 * These three are one experiment: the builder produces a binary, the ABI VM
 * confirms that binary links against nothing but stable system libraries, and
 * the device VM runs it. A point-release skew between them turns that chain
 * into three unrelated observations — the ABI check would be vouching for a
 * userland the device harness does not have.
 *
 * The registry's other Lima entries (`testGlibc`, `testMusl`, `virtualIpod`)
 * deliberately float on the distro's `latest` image. They run podkit's own test
 * suite or a demo; none of them is the environment an ABI claim is made about,
 * and floating is what keeps them cheap.
 */
export const PINNED_DEBIAN_IMAGE_VM_IDS: readonly LimaVmId[] = [
  'device',
  'builderGlibc',
  'abiVerify',
];

/**
 * Repo-relative path of the shell half of the contract, which restates
 * {@link SUBSTRATE_DEBIAN_MAJOR} and {@link SUBSTRATE_DEBIAN_POINT_RELEASE} as
 * bash variables because a Debian box has no TypeScript on it (and must not:
 * the contract forbids a toolchain on the substrate).
 */
export const SUBSTRATE_CONTRACT_REL_PATH =
  'test-packages/device-testing/scripts/substrate-contract.sh';

/**
 * Repo-relative path of the *builder* contract — the second profile, which
 * restates the same two Debian values for the same reason and must move with
 * them.
 *
 * A builder is not a substrate and the two contracts contradict each other on
 * purpose (ADR-029 §4), but they agree on the Debian release, and that
 * agreement is load-bearing: the builder's glibc becomes the produced binary's
 * minimum, so a builder on a newer release yields artifacts the substrate
 * cannot start. `builder-contract.test.ts` asserts it, along with everything
 * about the two profiles that must NOT converge.
 */
export const BUILDER_CONTRACT_REL_PATH = 'test-packages/device-testing/scripts/builder-contract.sh';

/**
 * Directory on a PVE host holding the pinned cloud image. `bootstrap-pve.sh`
 * places it there; the lifecycle client imports the disk from it.
 */
export const PVE_IMAGE_DIR = '/var/lib/vz/template/iso';

/** Filename of the pinned image for one architecture. */
export function substrateDebianImageFile(arch: DebianImageArch): string {
  return substrateDebianImageUrl(arch).slice(substrateDebianImageUrl(arch).lastIndexOf('/') + 1);
}

/** Absolute path the pinned image is expected at on a PVE host. */
export function pveDebianImagePath(arch: DebianImageArch): string {
  return `${PVE_IMAGE_DIR}/${substrateDebianImageFile(arch)}`;
}

/**
 * The image pin as one string, for inclusion in a provisioning baseline. A
 * guest booted from a different serial was provisioned from something the repo
 * no longer says.
 */
export const SUBSTRATE_IMAGE_PIN = [
  `debian=${SUBSTRATE_DEBIAN_MAJOR}`,
  `suite=${SUBSTRATE_DEBIAN_SUITE}`,
  `point=${SUBSTRATE_DEBIAN_POINT_RELEASE}`,
  `serial=${SUBSTRATE_DEBIAN_IMAGE_SERIAL}`,
].join(' ');
