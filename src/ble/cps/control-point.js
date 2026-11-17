import { existance, dataviewToArray }  from '../../functions.js';

const logs = true;

function log(msg) {
    if(logs) {
        console.log(msg);
    }
}

function RequestControl() {
    const opCode = 0x00;
    const length = 1;

    function encode() {
        const buffer = new ArrayBuffer(length);
        const view   = new DataView(buffer);
        view.setUint8(0, opCode, true);

        return view.buffer;
    }

    function decode(dataview) {
        const opCode = dataview.getUint8(0);
        return { opCode };
    }

    return Object.freeze({
        opCode,
        length,
        encode,
        decode
    });
}

function Response() {
    // Format:
    // ?

    const results = {
        '0x01': {definition: 'success',          msg: 'success'},
        '0x02': {definition: 'notSupported',     msg: 'not supported'},
        '0x03': {definition: 'invalidParameter', msg: 'invalid parameter'},
        '0x04': {definition: 'operationFail',    msg: 'operation fail'},
        '0x05': {definition: 'notPermitted',     msg: 'not permitted'},
    };

    function encode(value) {
    }

    function decode(dataview) {
        return dataviewToArray(dataview);
    }

    function toString(decoded = {}) {
        const str = decoded.join(', ');

        log(`:rx :cps :response '${str}'`);

        return str;
    }

    return Object.freeze({
        results,
        encode,
        decode,
        toString,
    });
}

// The pedals' settings over the standard control point (rider, Nov 17,
// 2026: "be able to see what … crank length the power pedals are set to …
// or even better, be able to actually adjust"). Crank length travels in
// half millimetres; every answer comes back as an indication:
// [0x20, the request's op code, result, parameters…].
const OP = {setCrankLength: 0x04, requestCrankLength: 0x05, startOffsetCompensation: 0x0C, response: 0x20};
const RESULT = {0x01: 'success', 0x02: 'not supported', 0x03: 'invalid parameter', 0x04: 'failed', 0x05: 'not permitted'};

function encodeRequestCrankLength() {
    return new Uint8Array([OP.requestCrankLength]).buffer;
}

// mm -> the pedal's half millimetres
function encodeSetCrankLength(mm) {
    const half = Math.round(Number(mm) * 2);
    if(!(half >= 2 * 100 && half <= 2 * 250)) throw new Error(`a crank length of ${mm} mm is not plausible`);
    const view = new DataView(new ArrayBuffer(3));
    view.setUint8(0, OP.setCrankLength);
    view.setUint16(1, half, true);
    return view.buffer;
}

function encodeStartOffsetCompensation() {
    return new Uint8Array([OP.startOffsetCompensation]).buffer;
}

// DataView -> {request, ok, result, crankLength?, offset?}
function decodeResponse(view) {
    if(view.byteLength < 3 || view.getUint8(0) !== OP.response) return null;
    const request = view.getUint8(1);
    const code = view.getUint8(2);
    const out = {request, ok: code === 0x01, result: RESULT[code] ?? `code ${code}`};
    if(out.ok && request === OP.requestCrankLength && view.byteLength >= 5) out.crankLength = view.getUint16(3, true) / 2;
    if(out.ok && request === OP.startOffsetCompensation && view.byteLength >= 5) out.offset = view.getInt16(3, true);
    return out;
}

const control = {
    requestControl: RequestControl(),
    response:       Response(),
    OP,
    encodeRequestCrankLength,
    encodeSetCrankLength,
    encodeStartOffsetCompensation,
    decodeResponse,
};

export { control };

