# podkit demo recording
# Produces an animated GIF showing a typical podkit workflow.
# Requires: vhs (https://github.com/charmbracelet/vhs)
#
# run.sh exports DEMO_BIN (path to the compiled demo binary) before invoking
# this tape. All environment setup happens in the hidden block below.

Output packages/demo/demo.gif

Set Shell "zsh"
Set FontSize 16
Set FontFamily "Menlo"
Set Width 820
Set Height 600
Set Padding 20
Set LineHeight 1.2
Set Theme "Dracula+"
Set WindowBar Colorful
Set Margin 18
Set MarginFill "#9129d6"
Set CursorBlink true
Set WaitTimeout 30s
Set Framerate 15

Env HOME "/tmp/podkit-demo"

# --- Hidden setup: clean slate, install binary, configure prompt --------------
Set TypingSpeed 0ms
Hide
Type `rm -rf /tmp/podkit-demo && mkdir -p /tmp/podkit-demo/{media/music,media/videos,ipod,bin} && cp "$DEMO_BIN" /tmp/podkit-demo/bin/podkit`
Enter
Type `setopt INTERACTIVE_COMMENTS && printf '\e]10;#AAB2C0\e\\' && export PATH="$HOME/bin:$PATH"`
Enter
Type `PROMPT=$'%F{magenta}❯%f %{\e[97m%}' && preexec() { print -Pn '\e[0m' }`
Enter
Type "clear"
Enter
Show
Set TypingSpeed 50ms

# --- 1. Add a device ----------------------------------------------------------
Sleep 500ms
Type "# Let's take a look at setting up podkit to sync an iPod..."
Sleep 500ms
Enter
Sleep 100ms
Enter
Sleep 200ms
Type "# Register an iPod as a sync target"
Sleep 500ms
Enter
Wait /❯/
Sleep 500ms
Type "podkit device add -d myipod --path ~/ipod"
Sleep 500ms
Enter
Wait+Screen /Y.n/
Sleep 2s
Type "y"
Enter
Wait /❯/
Sleep 2s
Type "clear"
Enter
Wait /❯/
Sleep 500ms

# --- 2. Check device music (empty) --------------------------------------------
Type "# See what music is on the device"
Sleep 500ms
Enter
Wait /❯/
Sleep 500ms
Type "podkit device music"
Sleep 500ms
Enter
Wait /❯/
Sleep 2s
Type "clear"
Sleep 300ms
Enter
Wait /❯/
Sleep 500ms

# --- 3. Add a music collection ------------------------------------------------
Type "# Point podkit at a music folder"
Sleep 500ms
Enter
Wait /❯/
Sleep 500ms
Type "podkit collection add -t music -c main --path ~/media/music"
Sleep 500ms
Enter
Wait /❯/
Sleep 2s
Type "clear"
Sleep 300ms
Enter
Wait /❯/
Sleep 500ms

# --- 4. List music collection contents -----------------------------------------
Type "# Browse the collection"
Sleep 500ms
Enter
Wait /❯/
Sleep 500ms
Type "podkit collection music"
Sleep 500ms
Enter
Wait /❯/
Sleep 2s
Type "podkit collection music --artists"
Sleep 500ms
Enter
Wait /❯/
Sleep 2s
Type "clear"
Sleep 300ms
Enter
Wait /❯/
Sleep 500ms

# --- 5. Add a video collection ------------------------------------------------
Type "# Maybe add a video collection too"
Sleep 500ms
Enter
Wait /❯/
Sleep 500ms
Type "podkit collection add -t video -c movies --path ~/media/videos"
Sleep 500ms
Enter
Wait /❯/
Sleep 2s
Type "podkit collection video --tracks"
Sleep 500ms
Enter
Wait /❯/
Sleep 2s
Type "clear"
Sleep 300ms
Enter
Wait /❯/
Sleep 500ms

# --- 6. Sync everything to the device -----------------------------------------
Type "# Sync everything to the iPod"
Sleep 500ms
Enter
Wait /❯/
Type "podkit sync --dry-run"
Sleep 500ms
Enter
Wait@60s /❯/
Sleep 1s
Sleep 500ms
Type "podkit sync"
Sleep 500ms
Enter
Wait@60s /❯/
Sleep 2s
Type "clear"
Sleep 300ms
Enter
Wait /❯/
Sleep 500ms

# --- 7. Eject the device ------------------------------------------------------
Type "# Safely eject when done"
Sleep 500ms
Enter
Wait /❯/
Sleep 500ms
Type "podkit eject"
Sleep 500ms
Enter
Wait /❯/
Sleep 1s
Enter
Sleep 100ms
Enter
Sleep 150ms
Type "# Enjoy your iPod!"

# Let the final output linger
Sleep 3s
