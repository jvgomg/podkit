---
title: About This Project
description: The story behind podkit, why it exists, how it's built, and where it's going.
sidebar:
  order: 1
---

## Who I Am

I'm [James Greenaway](https://jvg.omg.lol), a software designer and developer from the UK. TypeScript is my weapon of choice and podkit is the project I've wanted to exist for years.

## Why podkit Exists

A while back I modded a 5th generation iPod with an iFlash adapter – my _Terapod_. I was excited to finally have a nostalgic music player with serious storage, but the iPod ended up in a drawer because getting music onto it was just so painful.

I primarily use Mac and Linux. The only viable sync option I had was booting up a Windows machine I rarely use, opening the terrible combination of Apple Music and Apple Device Manager, and clicking through dodgy dialogs. My music collection had to be mirrored into iTunes or I had to surrender to using Apple Music full time. iPod software support has degraded over the years and the whole experience was neither fun nor easy.

Then I discovered [beets](https://beets.io/) for organising and tagging music and [Navidrome](https://www.navidrome.org/) for making my collection accessible anywhere. This rekindled my interest in properly owning my music collection and I pulled out the dusty iPod.

I wanted a Linux-centric approach so I could centralise music syncing onto a Proxmox VM or LXC container. I tried everything. Running an old version of iTunes under Wine, gtkpod, and eventually [Strawberry](https://www.strawberrymusicplayer.org/). I even [patched a transcoding bug](https://gist.github.com/jvgomg/38089836f8f47aa6dcf628edac0dec08) I found in Strawberry's code. But album artwork wouldn't sync consistently (I've since learnt enough about [iPod internals](/devices/ipod-internals/) to understand why) and there was no good incremental sync. Dropping a batch of songs onto the iPod would just create duplicates.

Through debugging Strawberry's code I discovered that [libgpod](https://sourceforge.net/projects/gtkpod/files/libgpod/) powered its iPod functionality. At that point I'd learnt enough about the state of the aging iPod software ecosystem to know that nothing out there actually solved my problem. I needed syncing to be effortless. Update my iPod with a single command, no clicking, no thinking. So I built a native Node.js binding around libgpod called [libgpod-node](/developers/libgpod/) and wrote a first prototype. podkit grew from there.

## How It's Built

podkit is designed around a few core beliefs.

**One command, zero thinking.** Syncing an iPod should be effortless. You run `podkit sync`, walk away, and your iPod is up to date. No GUI, no clicking, no babysitting.

**A core library, not just a CLI.** podkit is structured as a monorepo with a clear separation between the [core library](/developers/architecture/) (`podkit-core`) and the CLI (`podkit-cli`). The core package contains all the knowledge about syncing, transcoding, diffing, and iPod management. The CLI is just one interface built on top of it. The same core could power a TUI, a desktop app, or someone else's project entirely.

**Tested against real hardware.** There's a robust end-to-end test framework that runs against virtual iPod databases for fast iteration, but we verify support on [real devices](/devices/supported-devices/). If a device is listed as supported, it's been tested with an actual iPod.

**Smart transcoding.** Lossless files get transcoded, compatible lossy files are copied directly, and nothing is re-encoded unnecessarily. Your source files are never touched.

**The iPod is a solved problem. The software isn't.** There's a wealth of undocumented knowledge about using iPods today. Edge cases, firmware quirks, OS-specific issues. podkit aims to document that knowledge and bake it into the tool so you don't have to figure it out yourself.

**Collections, devices, config.** The problem is modelled as three concepts. Your music lives in [collections](/user-guide/collections/) (local directories, Subsonic servers), you sync to [devices](/user-guide/devices/) (your iPods), and [configuration](/user-guide/configuration/) ties them together. Simple enough to be flexible without being complicated.

**Stock firmware first, then beyond.** By solving the hard problem of syncing with Apple's stock iPod firmware and the iTunesDB format, podkit builds a foundation that can extend to easier targets in the future. Devices like Rockbox-flashed iPods or standalone DAPs.

## Where It's Going

My personal end goal is this: I plug my iPod into a headless computer, get a notification on my phone about what new music will be synced, and then another notification when it's done and I can unplug. No screen, no keyboard, no interaction.

The bigger vision is for podkit to become the go-to project for syncing music to iPod devices, and a library that lets other developers build iPod syncing into their own apps. I'm hoping that the iPod community can help develop this into something robust, well-documented, and always up to date.

That's a big goal for a one-person project, which is why community involvement matters so much. The [roadmap](/project/roadmap/) is shaped by real feedback from real users, and I'm actively looking for [beta testers](https://github.com/jvgomg/podkit/discussions/22) to help get podkit to where it needs to be.

If any of this resonates with you, I'd love to hear from you. [Come say hello](https://github.com/jvgomg/podkit/discussions) and help shape what podkit becomes.
