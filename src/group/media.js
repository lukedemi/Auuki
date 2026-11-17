//
// Video and audio for a group ride, on Cloudflare RealtimeKit.
//
// Kept to this one file so the provider can be swapped (doc/group-ride.md §
// Media). The ride never depends on it: no video set up, a refused camera,
// RealtimeKit down — the workout and the numbers carry on regardless.
//
// The SDK plays everyone's audio itself; this file attaches video to tiles.
// People join muted (trainers and fans are loud), camera on.
//

import { xf } from '../functions.js';

export async function startMedia({rideId, token, riderId}) {
    const res = await fetch(`/api/group/${rideId}/media`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token}),
    });
    if(res.status === 501) return null;          // no video set up for group rides
    const body = await res.json().catch(() => ({}));
    if(!res.ok || !body.authToken) throw new Error(body.error ?? `video: ${res.status}`);

    const {default: RealtimeKitClient} = await import('@cloudflare/realtimekit');
    const meeting = await RealtimeKitClient.init({
        authToken: body.authToken,
        defaults: {audio: false, video: true},
        onError: (err) => console.warn('group: video', err),
    });
    await meeting.join();

    const changed = () => xf.dispatch('group:media', state());
    const byRider = (id) => {
        if(id === riderId) return meeting.self;
        return meeting.participants.joined.toArray().find((p) => p.customParticipantId === id) ?? null;
    };
    const attached = new Map();    // video element → participant

    // a tile's <video>, for a rider: (re)registered whenever the tile is drawn
    // or that rider's media changes
    function attach(id, el) {
        const p = byRider(id);
        const prev = attached.get(el);
        if(prev === p) return !!p?.videoEnabled;
        if(prev) { try { prev === meeting.self ? prev.deregisterVideoElement(el, true) : prev.deregisterVideoElement(el); } catch(_) {} }
        attached.delete(el);
        if(!p) return false;
        if(p === meeting.self) p.registerVideoElement(el, true); else p.registerVideoElement(el);
        attached.set(el, p);
        return !!p.videoEnabled;
    }
    function hasVideo(id) {
        return !!byRider(id)?.videoEnabled;
    }
    function isOn(id) {
        return !!byRider(id)?.audioEnabled;
    }

    meeting.participants.joined.on('participantJoined', changed);
    meeting.participants.joined.on('participantLeft', changed);
    meeting.participants.joined.on('videoUpdate', changed);
    meeting.participants.joined.on('audioUpdate', changed);
    meeting.self.on('videoUpdate', changed);
    meeting.self.on('audioUpdate', changed);
    meeting.participants.on('activeSpeaker', (p) => xf.dispatch('group:speaker', p?.customParticipantId ?? null));

    function state() {
        return {available: true, mic: !!meeting.self.audioEnabled, cam: !!meeting.self.videoEnabled};
    }

    const api = {
        state,
        attach,
        hasVideo,
        isOn,
        async setMic(on) { try { on ? await meeting.self.enableAudio() : await meeting.self.disableAudio(); } catch(err) { console.warn(err); } changed(); },
        async setCam(on) { try { on ? await meeting.self.enableVideo() : await meeting.self.disableVideo(); } catch(err) { console.warn(err); } changed(); },
        async leave() { try { await meeting.leave(); } catch(_) {} attached.clear(); },
    };
    return api;
}
