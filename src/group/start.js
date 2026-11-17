//
// The app's group-ride controller (group.js), started once the ride in
// progress, if any, has been restored (db.js app:start → workout:restore).
// Kept apart from group.js so the tests can build controllers of their own.
//

import { xf } from '../functions.js';
import { GroupController } from './group.js';

// ticker.js in a Worker: a background tab throttles page timers, not this
function workerTicker(onTick) {
    const w = new Worker(new URL('./ticker.js', import.meta.url));
    w.addEventListener('message', onTick);
    return {start: () => w.postMessage('start'), stop: () => w.postMessage('stop')};
}

const group = GroupController({makeTicker: workerTicker});
group.wire();
xf.sub('workout:restore', () => { group.start(); }, {once: true});
window.group = group;

export { group };
