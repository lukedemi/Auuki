/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import { idle, press, seconds, clock } from '../src/stopwatch.js';
import '../src/views/lap-stopwatch.js';
import '../src/views/keyboard.js';

// Nov 27, 2026: "you press the letter L and it starts a little tiny timer,
// and that's all it does"
describe('the lap stopwatch', () => {
    test('a press starts a lap at the ride time; the next keeps the last one', () => {
        let s = press(idle(), 100);
        expect(seconds(s, 100)).toBe(0);
        expect(seconds(s, 352)).toBe(252);
        s = press(s, 352);
        expect(s).toEqual({start: 352, n: 2, last: 252});
        expect(seconds(idle(), 400)).toBe(null);
    });
    test('times read like a clock', () => {
        expect(clock(7)).toBe('0:07');
        expect(clock(252)).toBe('4:12');
        expect(clock(3723)).toBe('1:02:03');
    });

    describe('the pill', () => {
        let el, seen, abort;
        const key = () => window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyL', key: 'l'}));
        beforeEach(() => {
            el = document.createElement('lap-stopwatch');
            document.body.append(el);
            seen = [];
            abort = new AbortController();
            for(const e of ['ui:watchLap', 'stopwatch:lap']) xf.sub(e, () => seen.push(e), {signal: abort.signal});
            xf.dispatch('db:elapsed', {elapsed: 600});
        });
        afterEach(() => { el.remove(); abort.abort(); });

        test('hidden until L, then counts on the ride clock; L never skips the interval', () => {
            expect(el.classList.contains('on')).toBe(false);
            key();
            expect(el.classList.contains('on')).toBe(true);
            expect(seen).toEqual(['stopwatch:lap']);
            xf.dispatch('db:elapsed', {elapsed: 675});
            expect(el.querySelector('.sw--time').textContent).toBe('1:15');
            expect(el.querySelector('.sw--last').textContent).toBe('');
        });
        test('a second L starts lap 2 from zero and shows the last', () => {
            key();
            xf.dispatch('db:elapsed', {elapsed: 852});
            key();
            expect(el.querySelector('.sw--label').textContent).toBe('LAP 2');
            expect(el.querySelector('.sw--time').textContent).toBe('0:00');
            expect(el.querySelector('.sw--last').textContent).toBe('last 4:12');
        });
        test('a click puts it away, and so does stopping the ride', () => {
            key();
            el.click();
            expect(el.classList.contains('on')).toBe(false);
            key();
            xf.dispatch('db:watchStatus', {watchStatus: 'stopped'});
            expect(el.classList.contains('on')).toBe(false);
        });
    });
});
