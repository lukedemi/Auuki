# Solo and group: what changes in a group ride

A group ride (`doc/group-ride.md`) moves the workout by **the group's clock**:
every rider is on the same interval at the same second, worked out from a
shared server time. Anything that moves one rider's workout clock (skipping,
stretching, holding it) cannot work there, so each such feature is **solo
only**, and the switch is `db.groupMode` (`watch.js` keeps its own copy,
`self.groupMode`).

The rider asked for this list to be kept (Nov 26, 2026: *"a lot of these type
of things obviously would not work on a group ride. So make sure we're
keeping track of the things that should be part of a group ride and that are
for solo only rides."*). **A new feature that touches the workout clock adds
a row here in the same change.**

| Feature | Solo | Group ride | Where |
|---|---|---|---|
| **Ramp-back after a pause** (Nov 26, 2026) | Resuming holds the clock for 10 s (`RAMPBACK_S`) while the trainer climbs from the paused easy load to the target; the overlay counts down *BACK IN 10* over *Ramping back to X W · the clock waits*; ▶, Space or Skip ends it early. Nothing is recorded during it, so the chart has no dip | Resumes at once, at wherever the group is, and Power Match eases up over 20 s instead (`EASE_MS`) | `watch.js` `shouldRampBack`, `power-match.js` `onRampback`, `views/pause-overlay.js` |
| Pause | Stops the workout clock; resume picks up where it stopped | Stops recording only; the group's clock keeps going and a resume lands where everyone is | `watch.js` (the group branch of the tick), `group/group.js` |
| Lap / skip forward or back (L, the skip buttons) | Moves to the next or previous interval | Off: a lap is recorded, the interval does not change | `watch.js` `lap`, `back` |
| Jump to an interval | Works (the ramp test uses it to drop into its cool-down) | Off | `watch.js` `jump` |
| +5 min on this interval | Stretches the current interval | Off, button disabled with a tooltip | `watch.js` `ui:interval-extend`, `views/data-views.js` |
| Starting the workout | ▶, or auto-start when the rider pedals | The group's start time starts it; ▶ and pedalling start only the recording | `watch.js` `startWorkout`, `group/group.js` |
| End of the workout | Switches to SIM at 0% | Stays in ERG at the last target: the group's cool-down, ERG free, as long as anyone likes | `watch.js` workout done |
| Ramp test | The test: failure detection, straight into the cool-down, the result screen | **Not blocked yet** — a host could pick it, and its failure jump would do nothing. Solo only by design | `ramp-test.js` |
| Power Match | On | On (it corrects each rider's own trainer) | `power-match.js` |
| The trainer leads a step up (Nov 26, 2026) | With 2 s left before a step up of 30 W+, the trainer climbs so it is at the target as the interval starts | The same: it reads the step and its time left, which the group's clock sets | `power-match.js` `onStepTime`, `plan-ahead.js` |
| Auto-pause when the rider stops pedalling, auto-resume when they start | On | On; the resume is immediate (no ramp-back) | `watch.js` |
