//
// The group ride's ticker: a message every 50 ms, from a Worker because a
// background tab throttles the page's own timers (to once a minute after a
// while in Chrome) and a Worker's far less. group.js reads the clock on
// each one and acts when the second changes, so every rider's interval
// changes land within ~50 ms of the true boundary.
//

let timer = null;

self.addEventListener('message', (e) => {
    if(e.data === 'start' && timer === null) {
        timer = setInterval(() => self.postMessage(0), 50);
    }
    if(e.data === 'stop') {
        clearInterval(timer);
        timer = null;
    }
});
