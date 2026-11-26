/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import '../src/views/workout-done.js';
import '../src/views/pause-overlay.js';

// Nov 26, 2026: "When I'm done the workout, it should say, congratulations,
// and pop up. You should be able to click, no, I want to do more"
describe('the end of a solo workout', () => {
    let done, pause, seen, abort;
    beforeEach(() => {
        done = document.createElement('workout-done');
        pause = document.createElement('pause-overlay');
        document.body.append(done, pause);
        seen = [];
        abort = new AbortController();
        for(const e of ['ui:watchEnd', 'ui:keep-riding']) xf.sub(e, () => seen.push(e), {signal: abort.signal});
        xf.dispatch('db:workout', {workout: {meta: {name: 'Threshold 5×5 min'}, intervals: []}});
        xf.dispatch('watch:elapsed', 3612);
        xf.dispatch('db:watchStatus', {watchStatus: 'paused'});
        xf.dispatch('watch:done-prompt', true);
    });
    afterEach(() => { done.remove(); pause.remove(); abort.abort(); xf.dispatch('watch:done-prompt', false); });

    test('it pops up with the workout and the ride time, and the PAUSED banner stays away', () => {
        expect(done.classList.contains('on')).toBe(true);
        expect(done.textContent).toContain('Workout complete');
        expect(done.querySelector('.wd--name').textContent).toBe('Threshold 5×5 min');
        expect(done.querySelector('.wd--time b').textContent).toBe('1:00:12');
        expect(pause.classList.contains('on')).toBe(false);
    });
    test('Finish & save ends the ride', () => {
        done.querySelector('.wd--finish').click();
        expect(seen).toEqual(['ui:watchEnd']);
    });
    test('Keep riding carries on, and the popup goes', () => {
        done.querySelector('.wd--more').click();
        expect(seen).toEqual(['ui:keep-riding']);
        xf.dispatch('watch:done-prompt', false);
        expect(done.classList.contains('on')).toBe(false);
    });
});
