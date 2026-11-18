//
// Which screen is showing when (rider, Nov 18, 2026): the app opens on the
// workout selector, now called Home (page 'workouts'), not the live ride
// screen (page 'home', the menu's Ride). It goes to the ride screen by
// itself when there is a ride to see: one brought back after a reload, or a
// new one starting (▶, or pedalling with auto-start). A pause and resume
// leaves the rider wherever they went.
//
import { xf } from './functions.js';

export function StartPage(dispatch = (page) => xf.dispatch('ui:page-set', page)) {
    let fresh = true;    // no ride under way since load or the last stop
    return {
        restored() { fresh = false; dispatch('home'); },
        started()  { if(fresh) { fresh = false; dispatch('home'); } },
        stopped()  { fresh = true; },
    };
}

const startPage = StartPage();
xf.sub('session:restored', () => startPage.restored());
xf.sub('watch:started', () => startPage.started());
xf.sub('watch:stopped', () => startPage.stopped());

export default startPage;
