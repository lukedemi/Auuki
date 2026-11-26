/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import '../src/views/pause-overlay.js';

describe('pause overlay: the solo ramp-back', () => {
    let el, seen, abort;
    beforeEach(() => {
        el = document.createElement('pause-overlay');
        document.body.appendChild(el);
        seen = [];
        abort = new AbortController();
        for(const e of ['ui:rampback-skip', 'ui:watchStart', 'ui:workoutStart']) {
            xf.sub(e, () => seen.push(e), {signal: abort.signal});
        }
        xf.dispatch('db:watchStatus', {watchStatus: 'paused'});
        xf.dispatch('db:powerTarget', {powerTarget: 241.6});
    });
    afterEach(() => { el.remove(); abort.abort(); });

    const title = () => el.querySelector('.po--title').textContent;
    const sub = () => el.querySelector('.po--sub').textContent;
    const resume = () => el.querySelector('.po--resume');

    test('paused: PAUSED, and Resume starts the watch', () => {
        expect(el.classList.contains('on')).toBe(true);
        expect(title()).toBe('PAUSED');
        resume().click();
        expect(seen).toEqual(['ui:watchStart', 'ui:workoutStart']);
    });

    test('ramping back: a countdown to the target, green, and Resume becomes Skip', () => {
        xf.dispatch('watch:rampback', {left: 10, total: 10});
        expect(el.classList.contains('rampback')).toBe(true);
        expect(title()).toBe('BACK IN 10');
        expect(sub()).toBe('Ramping back to 242 W · the clock waits');
        expect(resume().textContent).toBe('Skip ▶');
        xf.dispatch('watch:rampback', {left: 3, total: 10});
        expect(title()).toBe('BACK IN 3');
        resume().click();
        expect(seen).toEqual(['ui:rampback-skip']);
    });

    test('the pedalling countdown cannot overwrite it', () => {
        xf.dispatch('watch:rampback', {left: 8, total: 10});
        xf.dispatch('watch:resume-countdown', 2);
        expect(el.classList.contains('pedalling')).toBe(false);
        expect(sub()).toBe('Ramping back to 242 W · the clock waits');
    });

    test('done: the overlay goes as the clock restarts', () => {
        xf.dispatch('watch:rampback', {left: 1, total: 10});
        xf.dispatch('watch:rampback', {left: 0, total: 10, done: true});
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        expect(el.classList.contains('on')).toBe(false);
        expect(el.classList.contains('rampback')).toBe(false);
    });

    test('cancelled (paused again): back to PAUSED', () => {
        xf.dispatch('watch:rampback', {left: 6, total: 10});
        xf.dispatch('watch:rampback', null);
        expect(title()).toBe('PAUSED');
        expect(resume().textContent).toBe('▶ Resume');
        expect(el.classList.contains('rampback')).toBe(false);
    });
});
