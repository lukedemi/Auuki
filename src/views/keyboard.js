import { xf, exists } from '../functions.js';
import { ControlMode, } from '../ble/enums.js';

function Keyboard() {

    const isKeyUp    = (code) => code === 'ArrowUp';
    const isKeyDown  = (code) => code === 'ArrowDown';
    const isKeyE     = (code) => code === 'KeyE';
    const isKeyR     = (code) => code === 'KeyR';
    const isKeyS     = (code) => code === 'KeyS';
    const isKeyL     = (code) => code === 'KeyL';
    const isKeySpace = (code) => code === 'Space';

    window.addEventListener('keydown', onKeydown.bind(this));

    function onKeydown(e) {
        let keyCode = e.keyCode;
        let code = e.code;

        // typing in a field (the target or Workout % inputs) is the field's
        if(['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;

        // Shift + Up / Down: the ERG target itself, 5 W a press
        if(e.shiftKey && !e.ctrlKey && !e.altKey && (isKeyUp(code) || isKeyDown(code))) {
            e.preventDefault();
            xf.dispatch(isKeyUp(code) ? 'key:shift:up' : 'key:shift:down');
            return;
        }

        if(e.isComposing ||
            keyCode === 229 ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey ||
            exists(e.target.form)) {
            return;
        }

        if(isKeyUp(code)) {
            e.preventDefault();
            xf.dispatch('key:up');
        }
        if(isKeyDown(code)) {
            e.preventDefault();
            xf.dispatch('key:down');
        }
        if(isKeyS(code)) {
            xf.dispatch('key:s');
        }
        if(isKeyR(code)) {
            xf.dispatch('key:r');
        }
        if(isKeyE(code)) {
            xf.dispatch('key:e');
        }
        if(isKeyL(code)) {
            xf.dispatch('key:l');
        }
        if(isKeySpace(code)) {
            e.preventDefault();
            xf.dispatch('key:space');
        }
    }
}


function KeyboardControls() {
    let mode = ControlMode.erg;
    xf.sub('db:mode', x => mode = x);

    let watchStatus = 'stopped';
    xf.sub('db:watchStatus', x => watchStatus = x);

    // Modes Inc/Dec. In ERG, Up / Down move the Workout % (this fork, Nov 13,
    // 2026, rider: "Pressing the up and down arrow key should change the
    // percentage power or workout percentage, not the power target number");
    // Shift + Up / Down still move the target 5 W.
    xf.sub('key:shift:up', e => {
        if(mode === ControlMode.erg) xf.dispatch('ui:power-target-inc');
    });
    xf.sub('key:shift:down', e => {
        if(mode === ControlMode.erg) xf.dispatch('ui:power-target-dec');
    });
    xf.sub('key:up', e => {
        if(mode === ControlMode.erg) {
            xf.dispatch('ui:intensity-inc');
        }
        if(mode === ControlMode.resistance) {
            xf.dispatch('ui:resistance-target-inc');
        }
        if(mode === ControlMode.sim) {
            xf.dispatch('ui:slope-target-inc');
        }
    });
    xf.sub('key:down', e => {
        if(mode === ControlMode.erg) {
            xf.dispatch('ui:intensity-dec');
        }
        if(mode === ControlMode.resistance) {
            xf.dispatch('ui:resistance-target-dec');
        }
        if(mode === ControlMode.sim) {
            xf.dispatch('ui:slope-target-dec');
        }
    });

    // Modes
    xf.sub('key:e', e => {
        xf.dispatch('ui:mode-set', ControlMode.erg);
    });
    // R and S switch to modes that are hidden unless Settings > Resistance &
    // Slope is on; a stray key must not leave the trainer in one of them
    const ergOnly = () => document.documentElement.classList.contains('erg-only');
    xf.sub('key:r', e => {
        if(ergOnly()) return;
        xf.dispatch('ui:mode-set', ControlMode.resistance);
    });
    xf.sub('key:s', e => {
        if(ergOnly()) return;
        xf.dispatch('ui:mode-set', ControlMode.sim);
    });

    // Watch
    xf.sub('key:space', e => {
        if(watchStatus === 'paused' || watchStatus === 'stopped') {
            xf.dispatch('ui:watchStart');
            xf.dispatch('ui:workoutStart');
        } else {
            xf.dispatch('ui:watchPause');
        }
    });
    xf.sub('key:l', e => {
        xf.dispatch('ui:watchLap');
    });
}

Keyboard();
KeyboardControls();

export { Keyboard, KeyboardControls };
