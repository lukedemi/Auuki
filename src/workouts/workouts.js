//
// The workout library (rider, Nov 18, 2026: "let's build out this workout
// library … come up with the list first, have consistent warmup/cooldown and
// vary the work. Let's get rid of ALL the existing workouts and make our own
// with a better naming scheme").
//
// Every workout is built here from a short spec, so they all share:
//
//   names      "<Type> <main set, with its units>", nothing cute (rider: "def
//              no cutsy names, actually build a consistent naming scheme that
//              says what it is"). The type is the filter it sits under:
//              Sweet Spot 3×15 min, Threshold 2×20 min, VO2 Max 30/15 s · 3×13,
//              Anaerobic 8×15 s sprints; a steady ride by its length:
//              Endurance 90 min; a variation after a "·": Endurance 90 min ·
//              cadence drills; tests as Test · what they are
//   warm-up    structured days 10 min: a 5-min ramp 45 → 65%, 3 min at 70%,
//              2 × 30 s openers at 100%; endurance, recovery and openers 5
//              min: the ramp alone
//   cool-down  structured days 10 min ramping 60 → 40%; the rest 5 min
//   rests      easy at 50% unless a format says otherwise; the last rep runs
//              straight into the cool-down
//
// The categories are the Home page's filters, in order of intensity. The
// card's one-line main set is read from the steps (workout-core.js); the
// description says what the workout is for.
//
// Power is a fraction of FTP. Durations below are in seconds or minutes as
// the helpers say.
//

const AUTHOR = 'infERGno';
const m = (min) => Math.round(min * 60);

// elements, as ZWO
const ss = (sec, p, cad) => `<SteadyState Duration="${sec}" Power="${p}"${cad ? ` Cadence="${cad}"` : ''}/>`;
const ramp = (sec, from, to) => (from <= to
    ? `<Warmup Duration="${sec}" PowerLow="${from}" PowerHigh="${to}"/>`
    : `<Cooldown Duration="${sec}" PowerLow="${from}" PowerHigh="${to}"/>`);
const reps = (n, onSec, onP, offSec, offP) => `<IntervalsT Repeat="${n}" OnDuration="${onSec}" OffDuration="${offSec}" OnPower="${onP}" OffPower="${offP}"/>`;
const EASY = 0.5;

// the standard ends
const WARMUP = [ramp(m(5), 0.45, 0.65), ss(m(3), 0.70), reps(2, 30, 1.0, 30, 0.55)];
const WARMUP_SHORT = [ramp(m(5), 0.45, 0.65)];
const COOLDOWN = [ramp(m(10), 0.60, 0.40)];
const COOLDOWN_SHORT = [ramp(m(5), 0.55, 0.40)];

// n reps of `rep` (a list of elements) with `rest` between, none after the last
const repeat = (n, rep, rest = []) => Array.from({length: n}, (_, i) => [...rep, ...(i < n - 1 ? rest : [])]).flat();
// n × work minutes at p, rest minutes easy between
const blocks = (n, workMin, p, restMin) => repeat(n, [ss(m(workMin), p)], [ss(m(restMin), EASY)]);
// sets of short on/off reps with a longer rest between sets
const sets = (count, n, onSec, onP, offSec, offP, setRestMin) => repeat(count, [reps(n, onSec, onP, offSec, offP)], [ss(m(setRestMin), EASY)]);
// one over-under rep: `units` × (2 min under, 1 min over)
const overUnder = (units, under = 0.95, over = 1.05) => repeat(units, [ss(m(2), under), ss(m(1), over)]);

const PURPOSE = {
    'Recovery':    'Spins the legs over and gets blood moving without adding fatigue. Keep it truly easy.',
    'Endurance':   'Aerobic base: the most useful training there is. Comfortable, steady, nose-breathing pace.',
    'Tempo':       'Muscular endurance just above endurance pace: steady pressure you could hold for an hour or two.',
    'Sweet Spot':  'Just under threshold: a big aerobic stimulus for less fatigue than threshold work.',
    'Threshold':   'At FTP: raises the power you can hold for an hour. Hard but controlled; even pacing.',
    'Over-Unders': 'Alternating just under and just over FTP: teaches the body to clear lactate while still working.',
    'VO2 Max':     'Near-maximal aerobic efforts: raises the ceiling. The last reps should be very hard.',
    'Anaerobic':   'Short, very hard efforts above VO2 max: power for attacks, short climbs and sprints.',
    'Race Prep':   'Opens the legs the day before a race: a few short efforts, nothing that tires.',
    'Test':        'A benchmark. Rested legs, the same conditions each time, and no hard training the day before.',
};

// [name, category, body, {warmup, cooldown, note}]
const short = {warmup: WARMUP_SHORT, cooldown: COOLDOWN_SHORT};
const LIBRARY = [
    // Recovery
    ['Recovery 30 min', 'Recovery', [ss(m(20), 0.5)], short],
    ['Recovery 45 min', 'Recovery', [ss(m(35), 0.5)], short],
    ['Recovery 60 min', 'Recovery', [ss(m(50), 0.5)], short],
    // Endurance
    ['Endurance 60 min', 'Endurance', [ss(m(50), 0.68)], short],
    ['Endurance 90 min', 'Endurance', [ss(m(80), 0.68)], short],
    ['Endurance 120 min', 'Endurance', [ss(m(110), 0.68)], short],
    ['Endurance 180 min', 'Endurance', [ss(m(170), 0.68)], short],
    ['Endurance 90 min · cadence drills', 'Endurance', [ss(m(10), 0.68), ...repeat(6, [ss(m(2), 0.68, 105), ss(m(3), 0.68, 85)]), ss(m(40), 0.68)],
        {...short, note: 'Six 2-minute spins at 105 rpm, then 3 minutes at 85, all at endurance power.'}],
    ['Endurance 120 min · 3×15 min tempo', 'Endurance', [ss(m(20), 0.68), ...repeat(3, [ss(m(15), 0.80)], [ss(m(10), 0.68)]), ss(m(25), 0.68)],
        {...short, note: 'Three 15-minute tempo blocks inside a 2-hour endurance ride.'}],
    // Tempo
    ['Tempo 2×15 min', 'Tempo', blocks(2, 15, 0.82, 5)],
    ['Tempo 3×15 min', 'Tempo', blocks(3, 15, 0.82, 5)],
    ['Tempo 2×20 min', 'Tempo', blocks(2, 20, 0.82, 5)],
    ['Tempo 1×45 min', 'Tempo', [ss(m(45), 0.80)]],
    // Sweet Spot
    ['Sweet Spot 3×10 min', 'Sweet Spot', blocks(3, 10, 0.90, 5)],
    ['Sweet Spot 4×10 min', 'Sweet Spot', blocks(4, 10, 0.90, 5)],
    ['Sweet Spot 3×12 min', 'Sweet Spot', blocks(3, 12, 0.90, 5)],
    ['Sweet Spot 3×15 min', 'Sweet Spot', blocks(3, 15, 0.90, 5)],
    ['Sweet Spot 2×20 min', 'Sweet Spot', blocks(2, 20, 0.90, 8)],
    ['Sweet Spot 2×30 min', 'Sweet Spot', blocks(2, 30, 0.88, 10)],
    // Threshold
    ['Threshold 5×5 min', 'Threshold', blocks(5, 5, 1.00, 3)],
    ['Threshold 4×8 min', 'Threshold', blocks(4, 8, 0.98, 4)],
    ['Threshold 3×10 min', 'Threshold', blocks(3, 10, 0.98, 5)],
    ['Threshold 3×12 min', 'Threshold', blocks(3, 12, 0.97, 6)],
    ['Threshold 3×14 min', 'Threshold', blocks(3, 14, 0.96, 6)],
    ['Threshold 2×15 min', 'Threshold', blocks(2, 15, 0.98, 8)],
    ['Threshold 2×20 min', 'Threshold', blocks(2, 20, 0.97, 10)],
    // Over-Unders
    ['Over-Unders 4×6 min', 'Over-Unders', repeat(4, overUnder(2), [ss(m(4), EASY)]), {note: 'Each rep is 2 minutes at 95%, 1 minute at 105%, twice.'}],
    ['Over-Unders 3×9 min', 'Over-Unders', repeat(3, overUnder(3), [ss(m(5), EASY)]), {note: 'Each rep is 2 minutes at 95%, 1 minute at 105%, three times.'}],
    ['Over-Unders 3×12 min', 'Over-Unders', repeat(3, overUnder(4), [ss(m(6), EASY)]), {note: 'Each rep is 2 minutes at 95%, 1 minute at 105%, four times.'}],
    ['Over-Unders 2×15 min · 30 s surges', 'Over-Unders', repeat(2, repeat(5, [ss(150, 0.90), ss(30, 1.10)]), [ss(m(8), EASY)]), {note: 'Sweet spot with a 30-second surge to 110% every 3 minutes.'}],
    // VO2 Max
    ['VO2 Max 6×2 min', 'VO2 Max', blocks(6, 2, 1.20, 2)],
    ['VO2 Max 5×3 min', 'VO2 Max', blocks(5, 3, 1.18, 3)],
    ['VO2 Max 4×4 min', 'VO2 Max', blocks(4, 4, 1.15, 4)],
    ['VO2 Max 5×4 min', 'VO2 Max', blocks(5, 4, 1.15, 4)],
    ['VO2 Max pyramid 1–4 min', 'VO2 Max', [1, 2, 3, 4, 3, 2, 1].flatMap((min, i, a) => [ss(m(min), 1.20), ...(i < a.length - 1 ? [ss(m(min), EASY)] : [])]),
        {note: 'Efforts of 1, 2, 3, 4, 3, 2 and 1 minutes at 120%, each followed by the same time easy.'}],
    ['VO2 Max 30/15 s · 3×13', 'VO2 Max', sets(3, 13, 30, 1.25, 15, EASY, 3), {note: 'The Rønnestad protocol: 3 sets of 13 × 30 s hard / 15 s easy, 3 minutes between sets. Judge it by heart rate, not watts.'}],
    ['VO2 Max 30/30 s · 2×10', 'VO2 Max', sets(2, 10, 30, 1.25, 30, EASY, 5)],
    ['VO2 Max 40/20 s · 2×10', 'VO2 Max', sets(2, 10, 40, 1.20, 20, EASY, 5)],
    // Anaerobic
    ['Anaerobic 8×1 min', 'Anaerobic', blocks(8, 1, 1.35, 2)],
    ['Anaerobic 10×30 s', 'Anaerobic', repeat(10, [ss(30, 1.50)], [ss(150, 0.45)])],
    ['Anaerobic 8×15 s sprints', 'Anaerobic', repeat(8, [ss(15, 2.00)], [ss(225, 0.45)]), {note: 'Flat-out 15-second sprints with full recovery. Out of the saddle if you like.'}],
    ['Anaerobic 20/10 s · 2×8', 'Anaerobic', sets(2, 8, 20, 1.70, 10, 0.45, 5), {note: '20 seconds very hard, 10 seconds easy, eight times; two sets.'}],
    // Race Prep
    ['Race Prep 45 min', 'Race Prep', [ss(m(10), 0.65), ...repeat(3, [ss(m(1), 1.10)], [ss(m(2), 0.55)]), ss(m(3), 0.55), ...repeat(3, [ss(15, 1.50)], [ss(105, 0.55)]), ss(m(11), 0.65)], short],
    ['Race Prep 30 min', 'Race Prep', [ss(m(5), 0.65), ...repeat(2, [ss(m(1), 1.10)], [ss(m(2), 0.55)]), ss(m(2), 0.55), ...repeat(2, [ss(15, 1.50)], [ss(105, 0.55)]), ss(m(7), 0.65)], short],
    // Tests
    ['Test · lactate steps 9×4 min', 'Test', [ss(m(5), 0.55), ...[0.55, 0.62, 0.69, 0.76, 0.83, 0.90, 0.97, 1.04, 1.11].map((p) => ss(m(4), p))],
        {note: '4-minute stages from 55% of FTP, about 20 W a step. Take a sample in the last 30 seconds of each; stop once past about 4 mmol or a failed stage.'}],
    ['Test · ramp 1 min steps', 'Test', Array.from({length: 21}, (_, i) => ss(m(1), Math.round((0.5 + i * 0.05) * 100) / 100)),
        {...short, note: '1-minute steps from 50% of FTP, 5% higher each minute, until you can no longer hold it. FTP is roughly 75% of your best minute.'}],
    ['Test · 20 min', 'Test', [ss(m(5), 1.05), ss(m(10), EASY), ss(m(20), 1.00)],
        {note: '5 minutes hard to open up, 10 easy, then 20 minutes as hard as you can hold. Raise the target if you can. FTP is 95% of the 20-minute average.'}],
];

function toZwo([name, category, body, opts = {}]) {
    const warmup = opts.warmup ?? WARMUP, cooldown = opts.cooldown ?? COOLDOWN;
    const description = [PURPOSE[category], opts.note].filter(Boolean).join(' ');
    return `<workout_file>
    <author>${AUTHOR}</author>
    <name>${name}</name>
    <category>${category}</category>
    <description>${description}</description>
    <sportType>bike</sportType>
    <tags></tags>
    <workout>
        ${[...warmup, ...body, ...cooldown].join('\n        ')}
    </workout>
</workout_file>
`;
}

// the one a first visit starts with
export const DEFAULT_WORKOUT = 'Endurance 60 min';
export const LIBRARY_SPEC = LIBRARY;

const workouts = LIBRARY.map(toZwo);

export { workouts };
