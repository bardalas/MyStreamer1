# Navigation QA plan (television, remote control)

**Goal:** the remote always does what a viewer expects - the focus is never lost, the focused item is always on screen, every move can be undone, and nothing is a trap.

**How it is run:** `python tools/navqa.py` drives the app on the emulator (or a device over adb): it opens each screen, presses the remote's keys, and after every press reads the focused element (its place, size, how much of it is inside the screen, which row it is in). A list of problems is written to `tools/navqa-report.md`.

## Rules (invariants) - a break of any is a finding

| id | rule | why it matters |
|----|------|----------------|
| N1 | After any arrow press the focus is on an element (never the page itself) | "the remote does nothing" |
| N2 | The focused element is at least 60% inside the screen after the move settles | "the view did not follow the focus" |
| N3 | One Down press moves at most one row down; one Up press at most one row up | "Down jumps two rows" |
| N4 | Down then Up (same number) returns to the element it started from | "cannot go up / another way back" |
| N5 | From any place, a run of Up presses reaches the top of the page (no trap) | "cannot go up" |
| N6 | Left/Right move to a neighbour in the same row; at the end of a row they stay (they never jump to another row) | wandering focus |
| N7 | Pressing the way to the menu enters it; the opposite way returns to the same element | menu reachable and left |
| N8 | Back from a title returns to the list with the same element focused | place kept |
| N9 | No press leaves the focus on an invisible/disabled element | ghost focus |

## Screens covered

Home; Movies and Series (wheel + pills); All movies / All series (grid); Library; Live TV; Search (field, suggestions, results); Genres; Shows; Settings (General, Profiles, Look, About and the others); Profiles picker; a movie's page; a series' page (seasons and episodes); Add-ons.

## Sequences per screen

1. **Down-walk:** Down x N (N=25 or to the end) recording each stop.
2. **Up-walk:** Up x the same N: must retrace (N4) and end at the start (N5).
3. **Right-walk:** along the first row to its end; **Left-walk** back.
4. **Menu:** the way to the menu, then the way back (N7).
5. Each stop is checked against N1-N3, N6, N9.

## Out of scope for this run
The player's own keys (live TV banner, seek) - covered by the live TV checks; text entry; the sign-in screen.
