import { xf, exists, existance, empty, equals, mavg, avg, max,
         first, second, last, clamp, toFixed, isArray,
         isString, isObject } from '../functions.js';

import { inRange, dateToDashString, getStartEndOfWeek, isToday, timeDiff, pad } from '../utils.js';

import { LocalStorageItem } from '../storage/local-storage.js';
import { idb } from '../storage/idb.js';
import { uuid } from '../storage/uuid.js';

import API from './api.js';
import { workouts as workoutsFile }  from '../workouts/workouts.js';
import { zwo } from '../workouts/zwo.js';
import { fileHandler } from '../file.js';
import { Model as Cycling } from '../physics.js';
import { fit } from '../fit/fit.js';
import liveSamples from '../live-samples.js';
import room from '../room.js';

import { Device, Status, ControlMode, } from '../ble/enums.js';
import { TimerStatus, EventType, } from '../activity/enums.js';

// atob gives one character per byte, which mangles any UTF-8 in a workout
// (an emoji or a dash in an intervals.icu workout name)
function decodeBase64Utf8(b64 = '') {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
}

// the left's % -> FIT left_right_balance (bit 7: the value is the right's)
function balanceToFit(left) {
    if(left === null || left === undefined || !(left >= 0 && left <= 100)) return 0xFF;
    return 0x80 | Math.round(100 - left);
}

class Model {
    constructor(args = {}) {
        this.init(args);
        this.prop      = args.prop;
        this.default   = existance(args.default, this.defaultValue());
        this.prev      = args.default;
        this.set       = existance(args.set, this.defaultSet);
        this.parser    = existance(args.parser, this.defaultParse);
        this.isValid   = existance(args.isValid, this.defaultIsValid);
        this.onInvalid = existance(args.onInvalid, this.defaultOnInvalid);
        this.storage   = this.defaultStorage();
        this.postInit(args);
    }
    init() { return; }
    postInit() { return; }
    defaultValue() { return ''; }
    defaultIsValid(value) { return exists(value); }
    defaultSet(value) {
        const self = this;
        if(self.isValid(value)) {
            self.state = value;
            // console.log(`${this.prop} : ${this.state}`);
            return value;
        } else {
            self.defaultOnInvalid(value);
            return self.default;
        }
    }
    defaultParse(value) {
        return value;
    }
    defaultOnInvalid(x) {
        const self = this;
        console.error(`Trying to set invalid ${self.prop}. ${typeof x}`, x);
    }
    defaultStorage() {
        const self = this;
        return {add: ((x)=>x),
                restore: ((_)=> self.default)};
    }
    backup(value) {
        const self = this;
        self.storage.set(value);
    }
    restore() {
        const self = this;
        return self.parser(self.storage.restore());
    }
}

class Power extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 2500);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return Number.isInteger(value) && inRange(self.min, self.max, value);
    }
}

class HeartRate extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 255);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        const self = this;
        return Number.isInteger(value) && inRange(self.min, self.max, value);
    }
}

class Cadence extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 255);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return Number.isInteger(value) && inRange(self.min, self.max, value);
    }
}

class Speed extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 120);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return (Number.isInteger(value) || Number.isFloat(value)) &&
                inRange(self.min, self.max, value);
    }
    kmhToMps(kmh) {
        return kmh / 3.6;
    }
    mpsToKmh(mps) {
        return mps * 3.6;
    }
    mpsToMph(mps) {
        return mps * 2.23693629;
    }
    kmhToMph(kmh) {
        return kmh * 0.621371192;
    }
}

class SmO2 extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 100);
        this.zones = {
            one: 30,
            two: 70,
            three: 100,
        };
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return inRange(self.min, self.max, value);
    }
}

class THb extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 400);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        return inRange(self.min, self.max, value);
    }
}

class Sources extends Model {
    postInit(args = {}) {
        const self = this;
        self.state = self.default;
        xf.sub('db:sources', value => self.state = value);

        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
            parse: JSON.parse,
            encode: JSON.stringify
        };

        self.storage = new args.storage(storageModel);
    }
    defaultSet(target, source) {
        return Object.assign(target, source);
    }
    isSource(path, value) {
        const self = this;
        if(exists(self.state[path])) {
            return equals(self.state[path], value);
        }
        return false;
    }
    defaultValue() {
        const sources = {
            // device data source map
            power:        'ble:controllable',
            cadence:      'ble:controllable',
            speed:        'ble:controllable',
            control:      'ble:controllable',
            heartRate:    'ble:heartRateMonitor',
            smo2:         'ble:smo2',
            thb:          'ble:smo2',
            coreBodyTemperature: 'ble:coreTemp',
            skinTemperature:     'ble:coreTemp',

            // settings
            virtualState: 'power',
            autoPause:    true,
            autoStart:    true,
            theme:        'DARK',

            // data tile settings
            // ['power1s', 'power3s']
            powerZStack: 0,
            // ['heartRate', 'heartRateLap', 'heartRateAvg']
            heartRateZStack: 0,
            // ['cadence', 'cadenceLap', 'cadenceAvg', 'cadenceTarget']
            cadenceZStack: 0,
            // ['powerLap', 'powerAvg', 'kcal', 'virtualGear']
            kcalZStack: 0,
            // ['graph', 'power']
            graphZStack: 0,
        };
        return sources;
    }
}

class Target extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 100);
        this.step = existance(args.step, 1);
    }
    defaultValue() { return 0; }
    defaultIsValid(value) {
        const self = this;
        return Number.isInteger(value) && inRange(self.min, self.max, value);
    }
    defaultSet(value) {
        const self = this;
        if(isNaN(value)) {
            self.onInvalid();
            return self.default;
        }
        return clamp(self.min, self.max, self.parse(value));
    }
    parse(value) { return parseInt(value); }
    inc(value) {
        const self = this;
        const x = value + self.step;
        return self.set(x);
    }
    dec(value) {
        const self = this;
        const x = value - self.step;
        return self.set(x);
    }
}

class Volume extends Target {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
            parse: parseInt,
        };
        self.min = existance(args.min, 0);
        self.max = existance(args.max, 100);
        self.step = existance(args.step, 10);
        self.storage = new args.storage(storageModel);
    }
    // 50, not 0: upstream shipped silent, so the interval beeps never
    // sounded unless the volume was found and raised (this fork, Nov 13, 2026)
    defaultValue() { return 50; }
    mute() {
        const self = this;
        return self.set(self.min);
    }
}

class PowerTarget extends Target {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 4000);
        // 5 W a press (was 10; rider, Nov 13, 2026)
        this.step = existance(args.step, 5);
    }
}

// The whole workout's intensity, % of every power target (this fork,
// Nov 13, 2026, rider: "it'd be even better to be able to change the
// percentage power across the whole workout"). 100 is the workout as
// written; each step's target is FTP × step % × intensity %.
class Intensity extends Target {
    postInit(args = {}) {
        this.min = existance(args.min, 50);
        this.max = existance(args.max, 150);
        this.step = existance(args.step, 1);
    }
    defaultValue() { return 100; }
}

class ResistanceTarget extends Target {
    postInit(args = {}) {
        this.min = existance(args.min, -100);
        this.max = existance(args.max, 100);
        this.step = existance(args.step, 10);
    }
    parse(value) { return parseInt(value); }
}

class SlopeTarget extends Target {
    postInit(args = {}) {
        this.min = existance(args.min, -40);
        this.max = existance(args.max, 40);
        this.step = existance(args.step, 0.5);
    }
    defaultIsValid(value) {
        const self = this;
        return Number.isFloat(value) && inRange(self.min, self.max, value);
    }
    parse(value) { return parseFloat(value); }
}

class CadenceTarget extends Target {
    postInit(args = {}) {
        this.min = existance(args.min, 0);
        this.max = existance(args.max, 255);
        this.step = existance(args.step, 5);
    }
    parse(value) { return parseInt(value); }
}

class Mode extends Model {
    postInit(args) {
        this.state = this.defaultValue();
        this.values = Object.values(ControlMode);
    }
    defaultValue() { return ControlMode.erg; }
    defaultIsValid(value) { return this.values.includes(value); }
}

class Page extends Model {
    postInit(args) {
        this.values = ['settings', 'home', 'workouts'];
    }
    defaultValue() { return 'home'; }
    defaultIsValid(value) { return this.values.includes(value); }
}

class FTP extends Model {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
            parse: parseInt,
        };
        self.state       = self.default;
        self.min         = existance(args.min, 0);
        self.max         = existance(args.max, 500);
        self.storage     = args.storage(storageModel);
        self.zones       = existance(args.zones, self.defaultZones());
        self.percentages = existance(args.percentages, self.defaultPercentages());
        self.minAbsValue = 9;
    }
    defaultValue() { return 200; }
    defaultIsValid(value) {
        const self = this;
        return Number.isInteger(value) && inRange(self.min, self.max, value);
    }
    defaultZones() {
        return ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    }
    defaultPercentages() {
        return {'one': 0.54, 'two': 0.75, 'three': 0.87, 'four': 0.94, 'five': 1.05, 'six': 1.20};
    }
    toRelative(value, ftp) {
        const self = this;
        if(value > self.minAbsValue) return toFixed(value / ftp, 2);
        return value;
    }
    toAbsolute(value, ftp) {
        const self = this;
        if(value < self.minAbsValue) {
            const roundedUpValue = Math.round(value * 100) / 100; // round up to second position after decimal point
            const absolute = Math.round(roundedUpValue * (ftp ?? self.state));
            return absolute;
        }
        return value;
    }
    powerToZone(value, ftp, zones) {
        const self = this;
        if(!exists(ftp)) ftp = self.state;
        if(!exists(zones)) zones = self.zones;

        let index = 0;
        let name = zones[index];
        if(value < (ftp * self.percentages.one)) {
            index = 0;
            name = zones[index];
        } else if(value < (ftp * self.percentages.two)) {
            index = 1;
            name = zones[index];
        } else if(value < (ftp * self.percentages.three)) {
            index = 2;
            name = zones[index];
        } else if(value < (ftp * self.percentages.four)) {
            index = 3;
            name = zones[index];
        } else if(value < (ftp * self.percentages.five)) {
            index = 4;
            name = zones[index];
        } else if (value < (ftp * self.percentages.six)) {
            index = 5;
            name = zones[index];
        } else {
            index = 6;
            name = zones[index];
        }
        return {name, index};
    }
    zoneToColor(zone) {
        if(equals(zone, 'one'))   return '#636468';
        if(equals(zone, 'two'))   return '#328AFF';
        if(equals(zone, 'thee'))  return '#44A5AB';
        if(equals(zone, 'four'))  return '#57C057';
        if(equals(zone, 'five'))  return '#F8C73A';
        if(equals(zone, 'six'))   return '#FF663A';
        if(equals(zone, 'seven')) return '#FE340B';
        return '#636468';
    }
    percentageToZone(value) {
        const self = this;
        const zones = self.zones;
        if(value < (self.percentages.one)) {
            return zones[0];
        } else if(value < (self.percentages.two)) {
            return zones[1];
        } else if(value < (self.percentages.three)) {
            return zones[2];
        } else if(value < (self.percentages.four)) {
            return zones[3];
        } else if(value < (self.percentages.five)) {
            return zones[4];
        } else if (value < (self.percentages.six)) {
            return zones[5];
        } else {
            return zones[6];
        }
        return zones[0];
    }
}

class Weight extends Model {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
            parse: parseFloat,
        };
        self.min = existance(args.min, 0);
        self.max = existance(args.max, 500);
        self.storage = new args.storage(storageModel);
    }
    defaultValue() { return 75; }
    defaultIsValid(value) {
        const self = this;
        return Number.isFinite(value) && inRange(self.min, self.max, value);
    }
}

class Theme extends Model {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
        };
        self.storage = new args.storage(storageModel);
        self.values = ['dark', 'light'];
    }
    defaultValue() { return 'dark'; }
    defaultIsValid(value) { return this.values.includes(value); }
    switch(theme) {
        const self = this;
        if(equals(theme, first(self.values))) return second(self.values);
        if(equals(theme, second(self.values))) return first(self.values);
        self.onInvalid(theme);
        return self.default;
    }
}

class DockMode extends Model {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
            parse: (x) => x === 'true',
        };
        self.storage = new args.storage(storageModel);
        self.values = [true, false];
    }
    defaultValue() { return false; }
    switch(state) {
        return !state;
    }
    apply(state) {
        const self = this;
        if(state && window.innerHeight > 200) {
            self.resize();
        }
    }
    calcSize() {
        const width = window.screen.availWidth;
        const height = 150;
        const top = window.screen.availHeight - height;
        return {width: width, height: height, top: top};
    }
    resize() {
        const self = this;
        let {width, height, top} = self.calcSize();
        window.resizeTo(width, height);
        window.moveTo(0, top);
    }
    open() {
        const href = document.location.href;
        let self = this;
        let { width, height, top } = self.calcSize();

        window.open(`${href}`, '', `width=${width},height=${height},left=0,top=${top}`);
        window.close();
    }
}

class Measurement extends Model {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
        };
        self.storage = new args.storage(storageModel);
        self.values = ['metric', 'imperial'];
    }
    // imperial by default in this fork (a stored choice wins)
    defaultValue() { return 'imperial'; }
    defaultIsValid(value) { return this.values.includes(value); }
    switch(theme) {
        const self = this;
        if(equals(theme, first(self.values))) return second(self.values);
        if(equals(theme, second(self.values))) return first(self.values);
        self.onInvalid(theme);
        return self.default;
    }
}

class DataTileSwitch extends Model {
    postInit(args = {}) {
        const self = this;
        const storageModel = {
            key: self.prop,
            fallback: self.defaultValue(),
        };
        self.storage = new args.storage(storageModel);
        this.values = [0, 1, 2];
    }
    defaultValue() { return 0; }
    defaultIsValid(value) { return this.values.includes(value); }
    defaultParse(value) {
        return parseInt(value);
    }
}

class Activity extends Model {
    // var activity = {
    //         id: UUID,
    //         blob: Blob,
    //         summary: {
    //             timestamp: Int,
    //             duration: Int,
    //             name: String,
    //             status: {
    //                 strava: String,
    //                 intervals: String,
    //                 trainingPeaks: String,
    //             }
    //         },
    // };

    name = 'activity';
    postInit(args) {
        this.api = args.api;
        this.capacity = 7;
    }
    defaultValue() { return []; }
    // Stopping saves the ride: no save button (rider, Nov 13, 2026: "You
    // should never have to click save though… I really want to be cautious
    // about losing stuff"). Everything is taken from db before the first
    // await, the write is read back before it counts, and a write that does
    // not read back downloads the .fit on the spot and throws, which keeps
    // the session backup (db.js only clears it on success).
    async createFromCurrent(db) {
        const id = uuid();
        const blob = fileHandler.toBlob(this.encode(db));
        const name = db.workout?.meta?.name ?? 'Powered by Auuki workout';

        const summary = {
            id,
            timestamp: Date.now(),
            name,
            duration: db.elapsed ?? 0,
            status: {strava: 'none', intervals: 'none', trainingPeaks: 'none'},
        };
        const record = {
            id,
            blob,
            summary,
            chart: this.chart(db),
        };

        let saved = null;
        try {
            await idb.put('activity', record);
            saved = await idb.get('activity', id);
        } catch(e) {
            console.error(':activity :save :error', e);
        }
        if(saved?.id !== id) {
            try {
                fileHandler.download()(blob, this.fileName(summary.timestamp), fileHandler.Type.OctetStream);
            } catch(e) {}
            throw new Error('the ride did not save to this browser, so its .fit was downloaded instead');
        }

        this.add(summary, db.activity);
        xf.dispatch('activity:add', summary);
        return summary;
    }
    async get(id) {
        const record = await idb.get('activity', id);
        return record?.id ? record : null;
    }
    // what the end-of-ride screen edits: name, rpe (1-10), feel (1-5, 1 best,
    // as intervals.icu has it), notes. Written straight to IndexedDB.
    // Writes to a saved ride go one at a time: two quick taps (RPE, then
    // feel) would otherwise each read the ride, and the second write would
    // drop the first one's field.
    serial(fn) {
        const next = (this.writes ?? Promise.resolve()).then(fn, fn);
        this.writes = next.catch(() => {});
        return next;
    }
    update(id, fields = {}, db = null) {
        return this.serial(async () => {
            const record = await this.get(id);
            if(!record) return null;
            Object.assign(record.summary, fields);
            await idb.put('activity', record);
            const listed = db?.activity?.find?.((a) => a.id === id);
            if(listed) Object.assign(listed, fields);
            xf.dispatch('activity:updated', record.summary);
            return record.summary;
        });
    }
    // The ride a second at a time, for the image button (ride-card.js): the
    // target is the one actually set, intensity and extensions included.
    chart(db) {
        try {
            const samples = liveSamples.all();
            return {
                v: 1, ftp: db.ftp ?? 0,
                t:      samples.map((r) => r.t),
                w:      samples.map((r) => Math.round(r.w || 0)),
                hr:     samples.map((r) => Math.round(r.hr || 0)),
                target: samples.map((r) => Math.round(r.target || 0)),
                // the trainer room once a minute, from Home Assistant (room.js), when it was reachable
                room: room.log(),
            };
        } catch(e) {
            return null;
        }
    }
    add(activity, activityList) {
        activityList.unshift(activity);
        if(activityList.length > this.capacity) {
            const summary = activityList.pop();
            idb.remove('activity', summary.id);
        }
        return activityList;
    }
    remove(id) {
        idb.remove('activity', id);
    }
    async upload(service, id) {
        const record = await this.get(id);
        if(!record) return ':fail';

        if(service === 'strava' ||
           service === 'intervals' ||
           service === 'trainingPeaks') {

            // uploadWorkout may note what the service called it on record.summary (intervals_id)
            const res = await this.api[service].uploadWorkout(record);
            const fresh = await this.serial(async () => {
                const fresh = (await this.get(id)) ?? record;
                fresh.summary.status[service] = res.substring(1);
                if(record.summary.intervals_id) fresh.summary.intervals_id = record.summary.intervals_id;
                await idb.put('activity', fresh);
                return fresh;
            });

            xf.dispatch(`action:activity:${id}`, `:${service}:upload${res}`);
            xf.dispatch('activity:updated', fresh.summary);
            return res;
        }
        return ':fail';
    }
    async download(id) {
        const self = this;
        const record = await idb.get('activity', id);
        fileHandler.download()(
            record.blob,
            self.fileName(record.summary.timestamp),
            fileHandler.Type.OctetStream
        );
    }
    fileName(timestamp) {
        return `workout-${dateToDashString(new Date(timestamp))}.fit`;
    }
    encode(db) {
        const records = db.records;
        const laps = db.laps;
        const events = db.events;
        const ftp = db.ftp;

        return fit.localActivity.encode({
            records,
            laps,
            events,
            ftp,
        });
    }
    async restore() {
        const records = await idb.getAll('activity') ?? [];

        // migrate summary.status String to {strava: String, intervals: String}
        records.forEach((record) => {
            if(typeof record.summary.status === 'string') {
                console.log(`:activity :migrating `, record.id);
                record.summary.status = {strava: 'none', intervals: 'none'};
                idb.put('activity', record);
            }
        });

        return records
            .map((record) => record.summary)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
}

// TODO:
// - differentiate between Workout and Activity
// - this model should hold methods related to working on a Workout as memeber of the
//   workout list or as the current selected workout
// - Activity is about the current active recording, session, and the list of actities
//   which are just recorded data or .fit format, Workout is about .zwo format
class Workout extends Model {
    postInit(args = {}) {
        const self = this;
        self.api = args.api;
    }
    // state init
    defaultValue() { return this.parse((first(workoutsFile))); }
    defaultIsValid(value) {
        return exists(value);
    }
    restore(db) {
        return first(db.workouts);
    }
    // accessors
    find(workouts, id) {
        for(let workout of workouts) {
            if(equals(workout.id, id)) {
                return workout;
            }
        }
        console.error(`tring to get a missing workout: ${id}`, workouts);
        return first(workouts);
    }
    // parsers
    parse(result, name = '') {
        if(isArray(result) || isObject(result)) {
            const view = new DataView(result);
            const courseJS = fit.localCourse.decode(view, name);
            console.log(courseJS);
            return courseJS;
        }
        return zwo.readToInterval(result);
    }
    fromIntervalsEvent(event) {
        const workout = this.parse(decodeBase64Utf8(event.workout_file_base64));
        workout.meta.planned = true;
        workout.meta.startDateLocal = event.start_date_local;
        workout.id = uuid();
        workout.intervals_id = event.id;
        return workout;
    }
    fromIntervalsResponse(response) {
        return response.map(this.fromIntervalsEvent.bind(this));
    }
    async readFromFile(file) {
        const result = await fileHandler.read(file);
        return {result, name: file.name};
    }
    encode(db) {
        const records = db.records;
        const laps = db.laps;
        const events = db.events;
        const ftp = db.ftp;

        return fit.localActivity.encode({
            records,
            laps,
            events,
            ftp,
        });
    }
    // utils
    fileName () {
        return `workout-${dateToDashString(new Date())}.fit`;
    }
    download(db) {
        fileHandler.download()(this.encode(db), this.fileName(), fileHandler.Type.OctetStream);
    }
    send(db) {
        // TODO: remove the whole method
        const name = this.fileName();
        const blob = fileHandler.toBlob(this.encode(db));

        this.api.strava.uploadWorkout(blob);

        return {
            name,
            blob,
        };
    }
}

// TODO:
// - rename to Libarary
// - use to just manage the library list of workouts
class Workouts extends Model {
    name = 'workouts';

    init(args) {
        const self = this;
        self.workoutModel = args.workoutModel;
    }
    defaultValue() {
        const self = this;
        return workoutsFile.map((w) => Object.assign(self.workoutModel.parse(w), {id: uuid()}));
    }
    defaultIsValid(value) {
        const self = this;
        return exists(value);
    }
    async restore(db) {
        const self = this;
        const workouts = await idb.getAll(`${self.name}`) ?? [];

        if(empty(workouts)) {
            return self.default;
        } else {
            return self.default.concat(workouts);
        }
    }
    get(workouts, id) {
        for(let workout of workouts) {
            if(equals(workout.id, id)) {
                return workout;
            }
        }
        console.error(`tring to get a missing workout: ${id}`, workouts);
        return first(workouts);
    }
    add(workouts, workout) {
        const self = this;
        workouts.push(idb.setId(workout));
        self.save(workout);
        return workouts;
    }
    save(workout) {
        const self = this;
        console.log(`:models :workouts :save`);
        idb.put(self.name, idb.setId(workout));
    }
    remove(workouts, id) {
        const self = this;
        if(!exists(id)) {
            console.error(`:models :workouts :remove 'called without workout id!'`);
            return workouts;
        }
        if(empty(workout)) {
            console.error(`:models :workouts :remove 'called with empty id!'`);
            return workouts;
        }
        idb.remove(self.name, id);
        return workouts.filter((w) => w.id !== id);
    }
}

function yesterdayOrOlder(timestamp) {
    return new Date().getDate() - new Date(timestamp).getDate() > 0;
}

// TODO:
// - standardize the methods
class Planned {
    name = 'planned';
    constructor(args = {}) {
        const self = this;
        this.data = this.defaultValue();
        this.workoutModel = args.workoutModel;
        this.athlete = {};
        this.storage = LocalStorageItem({
            key: 'planned',
            encode: JSON.stringify,
            parse: JSON.parse,
            fallback: this.defaultValue(),
        });
    }
    defaultValue() {
        return {workouts: [], modified: {}};
    }
    get(id) {
        for(let workout of this.data.workouts) {
            if(workout.id === id) {
                return workout;
            }
        }
        console.error(`tring to get a missing planned workout: ${id}`);
        return first(this.data.workouts);
    }
    setWorkouts(workouts) {
        this.data.workouts = workouts;
    }
    list() {
        return this.data.workouts;
    }
    setModified(service = 'intervals') {
        this.data.modified[service] = Date.now();
    }
    isEmpty() {
        return this.data.workouts.length === 0;
    }
    restore() {
        console.log(':planned :restore');

        this.data = this.storage.restore();

        if(yesterdayOrOlder(this.data.modified.intervals)) {
            console.log(`:planned :outdated :calling :wod 'intervals'`);
            this.getAthlete('intervals');
            this.wod('intervals');
            return;
        }

        console.log(`:planned :up-to-date`);
        xf.dispatch(`action:planned`, ':data');
    }
    backup() {
        this.storage.set(this.data);
        xf.dispatch(`action:planned`, ':data');
    }
    // force refresh the wod data
    async wod(service) {
        const self = this;
        if(service === 'intervals') {
            const { startOfWeek, endOfWeek } = getStartEndOfWeek(new Date(), true);
            const response = await api.intervals.wod(startOfWeek, endOfWeek);
            const workouts = self.workoutModel.fromIntervalsResponse(response);

            this.setWorkouts(workouts);
            this.setModified(service);
            this.backup();

            if(!this.isEmpty()) {
                for(let workout of this.data.workouts) {
                    if(isToday(workout.meta.startDateLocal)) {
                        const id = workout.id;
                        xf.dispatch(`action:li:${id}`, ':select');
                        break;
                    }
                }
            }
        }
    }
    async getAthlete(service) {
        const self = this;
        if(service === 'intervals') {
            const response = await api.intervals.getAthlete();
            console.log(response);
            if(response.weight > 0) {
                xf.dispatch('ui:weight-set', response.weight);
            }
            if(response.ftp > 0) {
                xf.dispatch('ui:ftp-set', response.ftp);
            }
        }
    }
}

// The ride in progress, kept in IndexedDB so a reload or a crashed tab
// does not lose it (this fork, Nov 13, 2026). Upstream wrote the whole
// session, every record in it, only on beforeunload and when the wake lock
// dropped, which a killed tab never reaches. Here the records go in
// one-minute chunks (store 'chunks', id = chunk number) as the ride runs,
// each full chunk written once; the session row (key 0) carries everything
// else and the record count. db.js backs up every 15 s and on pause.
const CHUNK = 60;

function Session(args = {}) {
    let name = 'session';
    let savedChunks = 0;   // full chunks already in IndexedDB
    let busy = false;

    async function backup(db) {
        if(busy) return;
        busy = true;
        try {
            const session = dbToSession(db);
            // db.records keeps growing while this awaits: take the length now
            const records = (session.records ?? []).slice();
            // a new ride: the chunks on disk belong to the last one
            if(records.length < savedChunks * CHUNK) {
                await idb.clear('chunks');
                savedChunks = 0;
            }
            const full = Math.floor(records.length / CHUNK);
            for(let i = savedChunks; i < full; i++) {
                await idb.put('chunks', {id: i, records: records.slice(i * CHUNK, (i + 1) * CHUNK)});
            }
            savedChunks = full;
            await idb.put('chunks', {id: full, records: records.slice(full * CHUNK)});

            session.records = undefined;
            session.chunked = true;
            session.recordCount = records.length;
            session.savedAt = Date.now();
            await idb.put('session', idb.setId(session, 0));
            xf.dispatch('session:backup', {records: records.length, elapsed: session.elapsed});
        } catch(e) {
            console.error(':session :backup :error', e);
            xf.dispatch('session:backup:error', String(e?.message ?? e));
        } finally {
            busy = false;
        }
    }

    async function restore(db) {
        const sessions = await idb.getAll(`${name}`);
        xf.dispatch(`${name}:restore`, sessions);
        console.log(`:idb :restore '${name}' :length ${sessions.length}`);

        let session = last(sessions);

        if(!empty(sessions)) {
            if(session.elapsed > 0) {
                if(session.chunked) {
                    const chunks = (await idb.getAll('chunks') ?? []).sort((a, b) => a.id - b.id);
                    const records = chunks.flatMap((c) => c.records ?? []).slice(0, session.recordCount ?? Infinity);
                    session.records = records;
                    savedChunks = Math.floor(records.length / CHUNK);
                }
                delete session.chunked;
                delete session.recordCount;
                const savedAt = session.savedAt;
                delete session.savedAt;
                sessionToDb(db, session);
                xf.dispatch('session:restored', {elapsed: session.elapsed, records: (session.records ?? []).length, savedAt});
            } else {
                idb.clear(`${name}`);
                idb.clear('chunks');
            }
        }
    }

    // the saved ride is gone once it is an activity
    async function clearSaved() {
        savedChunks = 0;
        await idb.clear(`${name}`);
        await idb.clear('chunks');
    }

    function sessionToDb(db, session) {
        return Object.assign(db, session);
    }

    function dbToSession(db) {
        const session = {
            // Watch
            elapsed: db.elapsed,
            lapTime: db.lapTime,
            stepTime: db.stepTime,
            intervalIndex: db.intervalIndex,
            stepIndex: db.stepIndex,
            intervalDuration: db.intervalDuration,
            stepDuration: db.stepDuration,
            lapStartTime: db.lapStartTime,
            watchStatus: db.watchStatus,
            workoutStatus: db.workoutStatus,

            // Course
            courseIndex: db.courseIndex,
            speedVirtual: db.speedVirtual,
            speed: db.speed,

            // Recording
            records: db.records,
            laps: db.laps,
            events: db.events,
            lap: db.lap,
            distance: db.distance,
            altitude: db.altitude,
            position_lat: db.position_lat,
            position_long: db.position_long,

            // Avg State
            kcal: db.kcal,
            powerLap: db.powerLap,
            cadenceLap: db.cadenceLap,
            heartRateLap: db.heartRateLap,
            powerAvg: db.powerAvg,
            cadenceAvg: db.cadenceAvg,
            heartRateAvg: db.heartRateAvg,
            powerLapCount: db.powerLapCount,
            cadenceLapCount: db.cadenceLapCount,
            heartRateLapCount: db.heartRateLapCount,
            powerAvgCount: db.powerAvgCount,
            cadenceAvgCount: db.cadenceAvgCount,
            heartRateAvgCount: db.heartRateAvgCount,

            // Report
            powerInZone: db.powerInZone,

            // Workouts
            workout: db.workout,
            mode: db.mode,
            lock: db.lock,
            page: db.page,

            // Targets
            powerTarget: db.powerTarget,
            intensity: db.intensity,
            resistanceTarget: db.resistanceTarget,
            slopeTarget: db.slopeTarget,

            // sources: db.sources,

            // UI options
            powerSmoothing: db.powerSmoothing,
        };

        return session;
    }

    function reset(db) {
        db.records = [];
        db.lap = [];
        db.laps = [];
        db.events = [];
        db.lapStartTime = false;
        db.rrInterval = [];

        db.elapsed = 0;
        db.lapTime = 0;
        db.stepTime = 0;
        db.intervalIndex = 0;
        db.stepIndex = 0;
        db.intervalDuration = 0;
        db.stepDuration = 0;

        db.resistanceTarget = 0;
        db.slopeTarget = 0;
        db.powerTarget = 0;
        db.intensity = 100;
        db.position_lat = 0;
        db.position_long = 0;
        db.altitude = virtualState.altitude;
        db.distance = virtualState.distance;
        db.ascent = virtualState.ascent;
        db.powerLap = powerLap.default;
        db.heartRateLap = heartRateLap.default;
        db.cadenceLap = cadenceLap.default;
        db.kcal = kcal.default;
        db.powerAvg = powerAvg.default;
        db.cadenceAvg = cadenceAvg.default;
        db.heartRateAvg = heartRateAvg.default;
        db.powerLapCount = powerLap.count;
        db.heartRateLapCount = heartRateLap.count;
        db.cadenceLapCount = cadenceLap.count;
        db.powerAvgCount = powerAvg.count;
        db.cadenceAvgCount = cadenceAvg.count;
        db.heartRateAvgCount = heartRateAvg.count;
    }

    function elapsed(x, db) {
        if(equals(db.watchStatus, TimerStatus.stopped)) {
            db.elapsed   = x;
            return;
        };

        db.elapsed = x;

        const speed = equals(db.sources.virtualState, 'speed') ?
                    db.speed :
                    db.speedVirtual;

        const record = {
            timestamp:  Date.now(),
            power:      db.power1s,
            cadence:    db.cadence,
            speed:      speed,
            heart_rate: db.heartRate,
            distance:   db.distance,
            grade:      db.slopeTarget,
            altitude:   db.altitude,
            position_lat:                 db.position_lat,
            position_long:                db.position_long,
            saturated_hemoglobin_percent: db.smo2,
            total_hemoglobin_conc:        db.thb,
            core_temperature:             db.coreBodyTemperature,
            skin_temperature:             db.skinTemperature,
            // FIT left_right_balance: the right's % with bit 7 set; 0xFF
            // (invalid) with no two-sided meter
            left_right_balance:           balanceToFit(db.balance),
            device_index:                 0,
        };

        db.records.push(record);
        if(!empty(db.rrInterval)) {
            db.records.push({time: pad(db.rrInterval, 5, 0xFFFF)});
        }

        db.lap.push(record);

        if(equals(db.elapsed % 60, 0)) {
            // models.session.backup(db);
            backup(db);
            console.log(`backing up of ${db.records.length} records ...`);
        }
    }

    function lap(x, db) {
        let timeEnd   = Date.now();
        let timeStart = db.lapStartTime;
        let elapsed   = timeDiff(timeStart, timeEnd);

        if(elapsed > 0) {
            const lap = {
                timestamp:        timeEnd,
                start_time:       timeStart,
                totalElapsedTime: elapsed,
                avgPower:         db.powerLap,
                maxPower:         max(db.lap, 'power'),
                avgCadence:       Math.round(avg(db.lap, 'cadence')),
                avgHeartRate:     Math.round(avg(db.lap, 'heart_rate')),
                saturated_hemoglobin_percent: toFixed(avg(db.lap, 'saturated_hemoglobin_percent'), 2),
                total_hemoglobin_conc: toFixed(avg(db.lap, 'total_hemoglobin_conc'), 2),
                core_temperature: toFixed(avg(db.lap, 'core_temperature'), 2),
                skin_temperature: toFixed(avg(db.lap, 'skin_temperature'), 2)
            };

            db.laps.push(lap);
            db.lap = [];
        }
        db.lapStartTime = timeEnd + 0;
    }

    function event(x, db) {
        if(!empty(db.events) && equals(last(db.events).type, x.type)) return;
        db.events.push(x);
    }

    return Object.freeze({
        backup,
        restore,
        reset,
        clearSaved,
        sessionToDb,
        dbToSession,

        elapsed,
        lap,
        event,
    });
}

class MetaProp {
    constructor(args = {}) {
        const self = this;
        this.init(args);
        this.prop     = args.prop ?? this.getDefaults().prop;
        this.disabled = args.default ?? this.getDefaults().disabled;
        this.default  = args.default ?? this.getDefaults().default;
        this.state    = args.state ?? this.default;
        this.name     = args.name ?? `meta-prop`;
        this.propName = self.toCamelCase(args.name) ?? `metaProp`;
        this.postInit(args);
        this.start();
    }
    init(args) {
        return args;
    }
    postInit(args = {}) {
        return args;
    }
    getPropValue(propValue) {
        return propValue;
    }
    getState() {
        return this.format(this.state);
    }
    setState(propValue) {
        return this.updateState(propValue);
    }
    format(state) {
        return state;
    }
    start() {
        this.subs();
    }
    stop() {
        this.unsubs();
    }
    toCamelCase(str) {
        if(exists(str)) {
            return str.replace(/-([a-z])/g, function (g) {
                return g[1].toUpperCase();
            });
        }
        return str;
    }
    subs() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };
        this.subsConfig();
    }
    subsConfig() { return; }
    unsubs() {
        this.abortController.abort();
    }
    onUpdate(propValue) {
        if(this.shouldUpdate(propValue)) {
            this.updateState(propValue);
        }
    }
    shouldUpdate() {
        return true;
    }
    updateState(value) {
        this.state = value;
        return this.state;
    }
}

class PropAccumulator extends MetaProp {
    postInit(args = {}) {
        this.event = args.event ?? this.getDefaults().event;
        this.count = this.getDefaults().count;
        this.prev  = this.getDefaults().prev;
    }
    getDefaults() {
        return {
            value: 0,
            prev: 0,
            default: 0,
            disabled: false,
            prop: '',

            event: '',
            prev: 0,
            count: 0,
        };
    }
    format(state) {
        return Math.round(state);
    }
    reset() { this.count = 0; }
    subsConfig() {
        if(!equals(this.prop, '')) {
            xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
        }
        if(!equals(this.event, '')) {
            xf.sub(`${this.event}`, this.onEvent.bind(this), this.signal);
        }
    }
    updateState(value) {
        if(this.state === 0 && value === 0) {
            this.state = 0;
        } else if(value === 0) {
            return this.state;
        } else {
            this.count += 1;
            const value_c = value;
            const value_p = this.prev;
            const count_c = this.count;
            const count_p = this.count-1;
            this.state = mavg(value_c, value_p, count_c, count_p);
            this.prev = this.state;

        }
        return this.state;
    }
    onEvent() {
        this.reset();
    }
    restore(db) {
        this.count = db[this.propName+"Count"] ?? this.count;
        this.state = db[this.propName] ?? this.state;
        this.prev = db[this.propName] ?? this.prev;
    }
}

class KcalAccumulator extends PropAccumulator {
    updateState(power) {
        this.state = this.state + power * 0.001;
        return this.state;
    }
}

const powerLap = new PropAccumulator({
    event: 'watch:lap',
    name: 'power-lap',
});
const powerAvg = new PropAccumulator({
    event: 'watch:stopped',
    name: 'power-avg',
});
const kcal = new KcalAccumulator({
    event: 'watch:stopped',
    name: 'kcal',
});

const cadenceLap = new PropAccumulator({
    event: 'watch:lap',
    name: 'cadence-lap',
});
const cadenceAvg = new PropAccumulator({
    event: 'watch:stopped',
    name: 'cadence-avg',
});

const heartRateLap = new PropAccumulator({
    event: 'watch:lap',
    name: 'heart-rate-lap',
});
const heartRateAvg = new PropAccumulator({
    event: 'watch:stopped',
    name: 'heart-rate-avg',
});



class PropInterval {
    constructor(args = {}) {
        const self = this;
        this.default     = existance(args.default, this.getDefaults().default);
        this.state       = existance(args.state, this.getDefaults().default);
        this.accumulator = existance(args.accumulator, this.getDefaults().accumulator);
        this.count       = existance(args.count, this.getDefaults().count);
        this.prop        = existance(args.prop, this.getDefaults().prop);
        this.effect      = existance(args.effect, this.getDefaults().effect);
        this.interval    = existance(args.interval, this.getDefaults().interval);
        this.zeroAfter   = existance(args.zeroAfter, 0);
        this.silent      = 0;
        this.start();
    }
    getDefaults() {
        const self = this;
        return {
            default: 0,
            accumulator: 0,
            count: 0,
            interval: 1000,
            prop: '',
            effect: '',
        };
    }
    start() {
        this.subs();
        this.intervalId = setInterval(this.onInterval.bind(this), this.interval);
    }
    stop() {
        clearInterval(this.intervalId);
        this.unsubs();
    }
    reset() {
        this.accumulator = 0;
        this.count = 0;
    }
    subs() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        xf.sub(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    unsubs() {
        this.abortController.abort();
    }
    onUpdate(propValue) {
        this.accumulator += propValue;
        this.count += 1;
    }
    onInterval() {
        if(equals(this.count, 0)) {
            // A sensor that stops sending is not still at its last value
            // (this fork, Nov 13, 2026): pedals and trainers often go
            // quiet when the cranks stop, which held power on screen and in
            // the file at the last reading, and kept auto-pause from firing.
            // After `zeroAfter` silent intervals the value is 0, and stays
            // a 0 a second (auto-pause counts seconds) until data returns.
            if(this.zeroAfter > 0 && ++this.silent >= this.zeroAfter) {
                this.state = 0;
                xf.dispatch(`${this.effect}`, 0);
            }
            return;
        }
        this.silent = 0;

        this.state = this.accumulator / this.count;
        xf.dispatch(`${this.effect}`, this.state);
        this.reset();
    }
}

class PowerInZone {
    constructor(args = {}) {
        const self = this;
        this.ftpModel = existance(args.ftpModel);
        this.default  = existance(args.default, this.getDefaults().default);
        this.count    = existance(args.count,   this.getDefaults().count);
        this.weights  = existance(args.weights, this.getDefaults().weights);
        this.state    = existance(args.state,   this.getDefaults().default);
        this.prop     = existance(args.prop,    this.getDefaults().prop);
        this.start();
    }
    getDefaults() {
        const self = this;
        const value = self.ftpModel.zones.map(x => [0,0]);
        const weights = self.ftpModel.zones.map(x => 0);

        return {
            default: value,
            weights: weights,
            count: 0,
            prop: 'db:elapsed',
        };
    }
    start() {
        this.subs();
    }
    stop() {
        this.unsubs();
    }
    subs() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        xf.reg(`${this.prop}`, this.onUpdate.bind(this), this.signal);
    }
    unsubs() {
        this.abortController.abort();
    }
    onUpdate(propValue, db) {
        this.updateState(db.power);
    }
    powerToZone(power) {
        return this.ftpModel.powerToZone(power);
    }
    updateState(value) {
        if(equals(value, 0)) return this.state;

        const zone = this.powerToZone(value);

        this.count += 1;
        this.weights[zone.index] += 1;

        for(let i=0; i < this.state.length; i++) {
            if(!equals(this.weights[i], 0)) {
                this.state[i] = [this.weights[i] / this.count, this.weights[i]];
            }
        }

        xf.dispatch('powerInZone', this.state);
        return this.state;
    }
}

class VirtualState extends MetaProp {
    postInit() {
        this.speed           = this.getDefaults().speed;
        this.altitude        = this.getDefaults().altitude;
        this.distance        = this.getDefaults().distance;
        this.ascent          = this.getDefaults().ascent;

        this.slope           = this.getDefaults().slope;
        this.riderWeight     = this.getDefaults().riderWeight;
        this.equipmentWeight = this.getDefaults().equipmentWeight;
        this.mass            = this.getDefaults().mass;

        this.source          = this.getDefaults().source;
        this.cycling         = Cycling({
            rho:             1.275,
            dragCoefficient: 0.88,   // 1.0, 0.88
            frontalArea:     0.36,   // 0.4, 0.36
            CdA:             0.3168, // 0.4, 0.3168
        });
        this.lastUpdate      = undefined;
    }
    getDefaults() {
        return {
            riderWeight: 75,
            equipmentWeight: 10,
            mass: 85,
            slope: 0.00,

            speed: 0,
            altitude: 0,
            distance: 0,
            ascent: 0,

            prop: 'power',
            source: 'power',
            disabled: false,
            default: 0,
        };
    }
    subs() {
        xf.reg(`${this.prop}`,  this.onUpdate.bind(this), this.signal);
        xf.sub(`db:sources`,    this.onSources.bind(this), this.signal);
        xf.sub(`db:weight`,     this.onWeight.bind(this), this.signal);
        xf.sub('watch:started', this.onStarted.bind(this), this.signal);
    }
    onSources(sources) {
        if(!equals(this.source, sources.virtualState)) {
            this.lastUpdate = Date.now();
        }

        this.source = sources.virtualState;
    }
    onWeight(weight) {
        this.riderWeight = weight;
        this.systemWeight = this.riderWeight + this.equipmentWeight;
    }
    onStarted() {
        this.lastUpdate = Date.now();
    }
    onUpdate(power, db) {
        if(!equals(this.source, this.prop)) return;

        // Take into acount the pauses
        const now = Date.now();
        const dt  = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;

        if(equals(dt, 0)) {
            // console.warn(`dt: ${dt}, s: ${this.speed}`);
            return;
        };

        const { speed, distance, altitude, ascent } = this.cycling.virtualSpeedCF({
            power:    db.power,
            slope:    db.slopeTarget / 100,
            distance: db.distance,
            altitude: db.altitude,
            ascent:   db.ascent,
            // the rider's weight + 10 kg of bike, once a weight is set; it
            // stayed at the 85 kg default whatever weight was set
            mass:     this.systemWeight > 10 ? this.systemWeight : this.mass,
            speed:    this.speed,
            dt:       isNaN(dt) ? 1/4 : dt,
        });

        this.speed = speed;

        // xf.dispatch('speedVirtual', (speed * 3.6));
        xf.dispatch('speedVirtual', speed);
        xf.dispatch('distance', distance);
        xf.dispatch('altitude', altitude);
        xf.dispatch('ascent', ascent);
    }
}

class SpeedState extends VirtualState {
    getDefaults() {
        return {
            prop: 'speed',
            source: 'power',
            disabled: false,
            default: 0,

            riderWeight: 75,
            equipmentWeight: 10,
            mass: 85,
            slope: 0.00,

            speed: 0,
            altitude: 0,
            distance: 0,
        };
    }
    onUpdate(speed, db) {
        if(!equals(this.source, this.prop)) return;

        const now = Date.now();
        const dt  = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;

        const { distance, altitude, ascent } = this.cycling.trainerSpeed({
            slope:     db.slopeTarget / 100,
            // speed:     db.speed / 3.6,
            speed:     db.speed,
            distance:  db.distance,
            altitude:  db.altitude,
            ascent:    db.ascent,
            speedPrev: this.speedPrev,
            mass:      this.mass,
            dt:        isNaN(dt) ? 1/4 : dt,
        });

        // this.speedPrev = speed / 3.6;
        this.speedPrev = speed;

        xf.dispatch('distance', distance);
        xf.dispatch('altitude', altitude);
        xf.dispatch('ascent', ascent);
    }
}

// 0 means no gear report has arrived yet.
// A real gear is 1 through 254. The protocol's highest set byte is 0xFF,
// and that byte decodes to gear 254.
class VirtualGear extends Model {
    postInit(args = {}) {
        this.min = existance(args.min, 1);
        this.max = existance(args.max, 254);
    }
    defaultValue() { return 0; }
    apply(gear, messages = []) {
        const list = isArray(messages) ? messages : [];
        let next = gear;

        for(let i = 0; i < list.length; i++) {
            next = this.applyOne(next, list[i]);
        }

        return next;
    }
    applyOne(gear, message) {
        if(!message) return gear;

        if(equals(message.action, 'shiftUp') && equals(message.state, 'pressed')) {
            if(gear < this.min) return this.min;
            return clamp(this.min, this.max, gear + 1);
        }

        if(equals(message.action, 'shiftDown') && equals(message.state, 'pressed')) {
            if(gear <= this.min) return gear;
            return gear - 1;
        }

        if(equals(message.action, 'gearSet') && equals(message.state, 'value') && Number.isFinite(message.value)) {
            return clamp(this.min, this.max, message.value);
        }

        return gear;
    }
}

class TSS {
    // TSS = (t * NP * IF) / (FTP * 3600) * 100
    // NP:
    // 1. Calculate a rolling 30-second average power for the workout or
    //    specific section of data
    // 2. Raise the resulting values to the fourth power.
    // 3. Determine the average of these values.
    // 4. Find the fourth root of the resulting average.
    // IF = NP / FTP
}


const api = API();

const power = new Power({prop: 'power'});
const cadence = new Cadence({prop: 'cadence'});
const heartRate = new HeartRate({prop: 'heartRate'});
const speed = new Speed({prop: 'speed'});
const smo2 = new SmO2({prop: 'smo2'});
const thb = new THb({prop: 'thb'});
const sources = new Sources({prop: 'sources', storage: LocalStorageItem});

const virtualState = new VirtualState();
const speedState   = new SpeedState();

const powerTarget = new PowerTarget({prop: 'powerTarget'});
const intensity = new Intensity({prop: 'intensity'});
const resistanceTarget = new ResistanceTarget({prop: 'resistanceTarget'});
const slopeTarget = new SlopeTarget({prop: 'slopeTarget'});
const cadenceTarget = new CadenceTarget({prop: 'cadenceTarget'});
const mode = new Mode({prop: 'mode'});
const page = new Page({prop: 'page'});

const ftp = new FTP({prop: 'ftp', storage: LocalStorageItem});
const weight = new Weight({prop: 'weight', storage: LocalStorageItem});
const theme = new Theme({prop: 'theme', storage: LocalStorageItem});
const dockMode = new DockMode({prop: 'dockMode', storage: LocalStorageItem});
const volume = new Volume({prop: 'volume', storage: LocalStorageItem});
const measurement = new Measurement({prop: 'measurement', storage: LocalStorageItem});
const dataTileSwitch = new DataTileSwitch({prop: 'dataTileSwitch', storage: LocalStorageItem});

const virtualGear = new VirtualGear({prop: 'virtualGear'});

const power1s = new PropInterval({prop: 'db:power', effect: 'power1s', interval: 1000, zeroAfter: 2});
const power3s = new PropInterval({prop: 'db:power', effect: 'power3s', interval: 3000});
const powerInZone = new PowerInZone({ftpModel: ftp});

const activity = new Activity({prop: 'activity', api: api});
const workout = new Workout({prop: 'workout', api: api});
const workouts = new Workouts({prop: 'workouts', workoutModel: workout});
const planned = new Planned({prop: 'planned', workoutModel: workout, api: api});

const session = Session();

let models = {
    intensity,
    power,
    heartRate,
    cadence,
    speed,
    smo2,
    thb,
    sources,

    virtualState,

    power1s,
    power3s,
    powerLap,
    powerAvg,
    powerInZone,
    kcal,
    virtualGear,

    heartRateLap,
    heartRateAvg,

    cadenceLap,
    cadenceAvg,

    powerTarget,
    resistanceTarget,
    slopeTarget,
    cadenceTarget,

    mode,
    page,
    ftp,
    weight,
    dockMode,
    volume,
    theme,
    measurement,
    dataTileSwitch,

    activity,
    workout,
    workouts,
    planned,
    session,

    PropInterval,

    api,
};

export { models, balanceToFit };
