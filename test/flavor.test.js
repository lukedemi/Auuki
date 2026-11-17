describe('the two ERGatory builds', () => {
    afterEach(() => { delete process.env.ERGATORY_FLAVOR; jest.resetModules(); });
    test('the household build has the room and the traces', () => {
        jest.resetModules();
        const { FLAVOR, flags, APP_NAME } = require('../src/flavor.js');
        expect(FLAVOR).toBe('home');
        expect(flags).toEqual({room: true, traces: true});
        expect(APP_NAME).toBe('ERGatory');
    });
    test('the public build has neither', () => {
        process.env.ERGATORY_FLAVOR = 'public';
        jest.resetModules();
        const { FLAVOR, flags } = require('../src/flavor.js');
        expect(FLAVOR).toBe('public');
        expect(flags).toEqual({room: false, traces: false});
    });
});
