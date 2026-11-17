import { Clock } from '../../src/group/clock.js';

describe('Clock', () => {
    test('unsynced, it is local time', () => {
        let t = 1000;
        const clock = Clock({local: () => t});
        expect(clock.synced()).toBe(false);
        expect(clock.now()).toBe(1000);
    });
    test('a symmetric round trip gives the exact offset', () => {
        let t = 1000;
        const clock = Clock({local: () => t});
        const ping = clock.ping();
        // server is 5 s ahead; 40 ms each way
        t = 1080;
        clock.onPong({t0: ping.t0, server: 1000 + 40 + 5000});
        expect(clock.offset()).toBe(5000);
        expect(clock.now()).toBe(1080 + 5000);
        expect(clock.rtt()).toBe(80);
    });
    test('keeps the fastest round trip', () => {
        let t = 0;
        const clock = Clock({local: () => t});
        // fast and true: offset 5000
        clock.onPong({t0: 0, server: 5010}, 20);
        // slow and lopsided (all the delay on the way back): would read 5000 + 200
        clock.onPong({t0: 100, server: 5100}, 500);
        expect(clock.offset()).toBe(5000);
    });
    test('ignores nonsense', () => {
        const clock = Clock({local: () => 0});
        clock.onPong({t0: 10, server: 5}, 5);          // negative rtt
        clock.onPong({t0: 'x', server: 5}, 5);
        expect(clock.synced()).toBe(false);
    });
    test('keeps the last offset across a reset until a new one is measured', () => {
        const clock = Clock({local: () => 0});
        clock.onPong({t0: 0, server: 5010}, 20);
        clock.reset();
        expect(clock.offset()).toBe(5000);
        clock.onPong({t0: 0, server: 3050}, 100);
        expect(clock.offset()).toBe(3000);
    });
});
