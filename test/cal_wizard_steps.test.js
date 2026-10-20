// Calibration Wizard step list + tuner-style open-string auto-detection.
// The wizard DOM can't run in the vm stub document, so these tests pin the
// wiring contracts at the SOURCE level and exercise the two pure-ish helpers
// (_calWizardResolveNoteChecks, _calWizardAutoDetectStrings) extracted from
// the real screen.js against stubs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Normalize line endings: the worktree checkout may be CRLF (autocrlf).
const SRC = fs.readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8').replace(/\r\n/g, '\n');

// Extract a function declared at `indent` spaces inside the plugin IIFE.
function extractFn(name, indent) {
    const pad = ' '.repeat(indent);
    const re = new RegExp('\\n' + pad + 'function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n' + pad + '\\}');
    const m = SRC.match(re);
    assert.ok(m, name + ' found in screen.js');
    return m[0];
}

// ── _CAL_WIZARD_STEPS ────────────────────────────────────────────────────────

function wizardSteps() {
    const m = SRC.match(/const _CAL_WIZARD_STEPS = (\[[\s\S]*?\]);/);
    assert.ok(m, '_CAL_WIZARD_STEPS literal found');
    // eslint-disable-next-line no-eval
    return eval(m[1]);
}

test('wizard has 9 steps and no tuner or gameplay step', () => {
    const steps = wizardSteps();
    assert.deepEqual(steps.map((s) => s.id),
        ['welcome', 'audio', 'noise', 'signal', 'notes', 'timing', 'review', 'ready', 'apply']);
    assert.ok(!steps.some((s) => s.id === 'tuner'), 'tuner step must be gone');
    assert.ok(!steps.some((s) => s.id === 'gameplay'), 'gameplay settings moved to the onboarding overlay');
    assert.ok(!SRC.includes("id: 'gameplay'"), 'no gameplay step id anywhere in the step list');
    assert.ok(!SRC.includes("id: 'tuner'"), 'no tuner step id anywhere in the step list');
});

test('wizard steps declare the plugins they need', () => {
    const steps = wizardSteps();
    const byId = {};
    steps.forEach((s) => { byId[s.id] = s.requires || []; });
    // Plugin-free steps need nothing; the measurement steps (noise/signal)
    // run before the plugin-dependent steps.
    assert.deepEqual(byId.welcome, []);
    assert.deepEqual(byId.audio, []);
    assert.deepEqual(byId.noise, []);
    assert.deepEqual(byId.signal, []);
    assert.deepEqual(byId.review, []);
    // Detection steps need the note detector itself.
    assert.deepEqual(byId.notes, ['note_detect']);
    assert.deepEqual(byId.timing, ['note_detect']);
    // The challenge gate needs the note detector AND the rig builder.
    assert.deepEqual(byId.ready, ['note_detect', 'rig_builder']);
    assert.deepEqual(byId.apply, ['note_detect', 'rig_builder']);
});

test('plugin-free steps come before plugin-dependent steps; the gate sits before apply', () => {
    const steps = wizardSteps();
    const idx = (id) => steps.findIndex((s) => s.id === id);
    const firstPluginStep = steps.findIndex((s) => (s.requires || []).length > 0);
    assert.equal(firstPluginStep, idx('notes'), 'notes is the first plugin-dependent step');
    assert.ok(idx('ready') > idx('review'), 'the challenge gate sits after review');
    assert.ok(idx('apply') > idx('ready'), 'apply (final check) is the last step');
});

test('wizard still carries the pre-challenge measurement steps', () => {
    const ids = wizardSteps().map((s) => s.id);
    for (const required of ['noise', 'signal', 'notes', 'timing']) {
        assert.ok(ids.includes(required), 'step "' + required + '" must remain before the challenge');
    }
});

// ── _calWizardResolveNoteChecks ──────────────────────────────────────────────

const STANDARD_GUITAR_MIDIS = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
const STANDARD_BASS_MIDIS = [28, 33, 38, 43];          // E1 A1 D2 G2

function buildResolveNoteChecks(ctx, stdMidis) {
    const src = extractFn('_calWizardResolveNoteChecks', 4)
        + '\nreturn _calWizardResolveNoteChecks;';
    // eslint-disable-next-line no-new-func
    const factory = new Function(
        '_calWizardResolveNoteCheckContext',
        '_calWizardOpenStringMidi',
        '_ndMidiToName',
        '_calWizardOpenStringLabel',
        '_calWizardOpenStringDisplayNum',
        src);
    return factory(
        () => ctx,
        (stringIndex) => stdMidis[stringIndex],
        (midi) => 'N' + midi,
        (stringIndex, stringCount, note) => 'String ' + (stringIndex + 1) + ' (' + note + ')',
        (stringIndex, stringCount) => String(stringCount - stringIndex));
}

test('resolveNoteChecks returns one check per open string (6-string guitar)', () => {
    const resolve = buildResolveNoteChecks(
        { hasTuning: false, arrangement: 'guitar', stringCount: 6, offsets: [0, 0, 0, 0, 0, 0], preset: null },
        STANDARD_GUITAR_MIDIS);
    const specs = resolve();
    assert.equal(specs.length, 6);
    specs.forEach((spec, s) => {
        assert.equal(spec.id, 'openS' + s);
        assert.equal(spec.string, s);
        assert.equal(spec.expectedMidi, STANDARD_GUITAR_MIDIS[s]);
        assert.equal(spec.expectedNote, 'N' + STANDARD_GUITAR_MIDIS[s]);
        assert.ok(spec.label.length > 0);
        assert.ok(spec.displayString.length > 0);
    });
});

test('resolveNoteChecks covers a 4-string bass', () => {
    const resolve = buildResolveNoteChecks(
        { hasTuning: false, arrangement: 'bass', stringCount: 4, offsets: [0, 0, 0, 0], preset: null },
        STANDARD_BASS_MIDIS);
    const specs = resolve();
    assert.equal(specs.length, 4);
    assert.equal(specs[0].expectedMidi, 28); // low B... E1 on a 4-string bass
});

test('resolveNoteChecks skips strings with no resolvable target', () => {
    const resolve = buildResolveNoteChecks(
        { hasTuning: false, arrangement: 'guitar', stringCount: 6, offsets: [0, 0, 0, 0, 0, 0], preset: null },
        [40, 45, null, 55, 59, 64]);
    const specs = resolve();
    assert.equal(specs.length, 5);
    assert.ok(!specs.some((s) => s.string === 2));
});

// ── _calWizardAutoDetectStrings ──────────────────────────────────────────────

function buildAutoDetect() {
    const src = extractFn('_calWizardAutoDetectStrings', 4)
        + '\n' + extractFn('_calWizardMidiNearTarget', 4)
        + '\nreturn _calWizardAutoDetectStrings;';
    // eslint-disable-next-line no-new-func
    return new Function(
        '_calWizardState',
        '_calWizardResolveNoteChecks',
        '_calWizardSetAutoStatus',
        '_ndMidiToName',
        '_ndNearestOctaveCents',
        'detectedConfidence',
        '_CAL_WIZARD_STRING_AUTO_TICKS',
        src);
}

const foldOctaveCents = (detected, expected) => {
    const cents = (detected - expected) * 100;
    const folded = Math.abs(cents) % 1200;
    return folded > 600 ? 1200 - folded : folded;
};

const TWO_STRINGS = [
    { id: 'openS0', label: 'Low E', expectedMidi: 40, expectedNote: 'E2', string: 0, displayString: '2' },
    { id: 'openS1', label: 'Open A', expectedMidi: 45, expectedNote: 'A2', string: 1, displayString: '1' },
];

function makeHarness(specs) {
    const statuses = [];
    const wiz = { step: 4, notes: {}, stringAutoDetect: null };
    const fn = buildAutoDetect();
    const autoDetect = fn(
        wiz,
        () => specs,
        (html) => { statuses.push(html); },
        (midi) => 'N' + midi,
        foldOctaveCents,
        0.5,
        3);
    return { wiz, autoDetect, statuses };
}

const snapHearing = (rawMidi) => ({ enabled: true, rawMidi, heardConfidencePct: 80 });

test('auto-detect ignores ticks when the wizard is not on the notes step', () => {
    const { wiz, autoDetect, statuses } = makeHarness(TWO_STRINGS);
    wiz.step = 3; // signal step — not the notes step
    autoDetect(snapHearing(40));
    assert.equal(statuses.length, 0, 'no status writes off the notes step');
    assert.deepEqual(wiz.notes, {});
});

test('auto-detect asks to enable Detect when detection is off', () => {
    const { autoDetect, statuses } = makeHarness(TWO_STRINGS);
    autoDetect({ enabled: false });
    assert.equal(statuses.length, 1);
    assert.match(statuses[0], /Turn Detect on/);
});

test('a string turns OK only after 3 consecutive stable ticks', () => {
    const { wiz, autoDetect, statuses } = makeHarness(TWO_STRINGS);
    autoDetect(snapHearing(40));
    assert.ok(!wiz.notes.openS0, 'tick 1: not yet');
    autoDetect(snapHearing(40));
    assert.ok(!wiz.notes.openS0, 'tick 2: not yet');
    autoDetect(snapHearing(40));
    const hit = wiz.notes.openS0;
    assert.ok(hit && hit.ok, 'tick 3: string verified');
    assert.equal(hit.heardNote, 'N40');
    assert.equal(hit.confidencePct, 80);
    assert.equal(hit.expectedNote, 'E2');
    assert.match(statuses[statuses.length - 1], /Low E OK/);
    assert.match(statuses[statuses.length - 1], /heard N40 \(80% conf\)/);
});

test('a pitch change resets the stability counter', () => {
    const { wiz, autoDetect } = makeHarness(TWO_STRINGS);
    autoDetect(snapHearing(40));
    autoDetect(snapHearing(40));   // openS0 stable x2
    autoDetect(snapHearing(45));   // player moved to the next string
    assert.ok(!wiz.notes.openS0, 'openS0 must not verify from 2 ticks + a detour');
    assert.ok(!wiz.notes.openS1, 'one tick on openS1 is not enough');
    autoDetect(snapHearing(40));   // back to openS0 — counter restarts at 1
    assert.ok(!wiz.notes.openS0, 'counter restarted: still not verified');
    autoDetect(snapHearing(40));
    autoDetect(snapHearing(40));   // ticks 2 and 3 of the restarted run
    assert.ok(wiz.notes.openS0 && wiz.notes.openS0.ok, 'verified after 3 fresh stable ticks');
});

test('off-target pitch never verifies a string', () => {
    const { wiz, autoDetect } = makeHarness(TWO_STRINGS);
    for (let i = 0; i < 6; i++) autoDetect(snapHearing(42)); // D#2/Eb2 — 2 semitones off
    assert.deepEqual(wiz.notes, {});
});

test('listening status shows progress and the next string to play', () => {
    const { wiz, autoDetect, statuses } = makeHarness(TWO_STRINGS);
    autoDetect(snapHearing(40));
    autoDetect(snapHearing(40));
    autoDetect(snapHearing(40)); // openS0 OK
    autoDetect(snapHearing(48)); // off-target: listening continues
    const last = statuses[statuses.length - 1];
    assert.match(last, /1\/2 heard/);
    assert.match(last, /Next: A2/);
});

test('all strings heard reports the instrument in tune', () => {
    const { wiz, autoDetect, statuses } = makeHarness(TWO_STRINGS);
    for (let i = 0; i < 3; i++) autoDetect(snapHearing(40));
    for (let i = 0; i < 3; i++) autoDetect(snapHearing(45));
    assert.ok(wiz.notes.openS0 && wiz.notes.openS0.ok);
    assert.ok(wiz.notes.openS1 && wiz.notes.openS1.ok);
    autoDetect(snapHearing(45));
    assert.match(statuses[statuses.length - 1], /All 2 strings heard — your instrument is in tune/);
});

// ── Plugin readiness gate (per-step requires + challenge gate) ──────────────

function buildPluginGate() {
    const src = extractFn('_calWizardPluginRow', 4)
        + '\n' + extractFn('_calWizardPluginReady', 4)
        + '\n' + extractFn('_calWizardStepRequires', 4)
        + '\n' + extractFn('_calWizardStepMissingPlugins', 4)
        + '\n' + extractFn('_calWizardChallengeReady', 4)
        + '\nreturn { _calWizardPluginRow, _calWizardPluginReady, _calWizardStepRequires,'
        + ' _calWizardStepMissingPlugins, _calWizardChallengeReady };';
    // eslint-disable-next-line no-new-func
    const factory = new Function(
        '_CAL_WIZARD_STEPS', '_CAL_WIZARD_CHALLENGE_PLUGINS', '_calWizardState', 'window', src);
    const steps = wizardSteps();
    const challengePlugins = steps.find((s) => s.id === 'ready').requires;
    return (state, win) => factory(steps, challengePlugins, state, win || {});
}

const GATE_ROWS = [
    { id: 'note_detect', name: 'Note Detection', status: 'ready', enabled: true },
    { id: 'rig_builder', name: 'Rig Builder', status: 'ready', enabled: true },
];

test('plugin gate: ready+enabled plugins pass, anything else is missing', () => {
    const build = buildPluginGate();
    const api = build({ step: 4, pluginStatus: { rows: [
        { id: 'note_detect', status: 'ready', enabled: true },
        { id: 'rig_builder', status: 'installing', enabled: true },
    ] } });
    assert.deepEqual(api._calWizardStepMissingPlugins(4), [], 'note_detect ready → notes step unblocked');
    assert.deepEqual(api._calWizardStepMissingPlugins(7), ['rig_builder'], 'rig_builder installing → challenge gate blocked');
    const api2 = build({ step: 7, pluginStatus: { rows: [
        { id: 'note_detect', status: 'ready', enabled: false },
        { id: 'rig_builder', status: 'ready', enabled: true },
    ] } });
    assert.deepEqual(api2._calWizardStepMissingPlugins(7), ['note_detect'], 'a disabled plugin counts as not ready');
    const api3 = build({ step: 7, pluginStatus: { rows: null } });
    assert.deepEqual(api3._calWizardStepMissingPlugins(7), ['note_detect', 'rig_builder'],
        'no /api/plugins snapshot yet → everything required is missing');
});

test('challenge gate also requires the note detector playSong wrapper', () => {
    const build = buildPluginGate();
    const state = { step: 7, pluginStatus: { rows: GATE_ROWS } };
    const noWrapper = build(state, {});
    const c1 = noWrapper._calWizardChallengeReady();
    assert.equal(c1.ndFunctional, false, 'no playSong wrapper → HUD not armed');
    assert.equal(c1.ready, false, 'plugins ready but no wrapper → challenge not ready');
    const withWrapper = build(state, {
        noteDetect: { injectButton: function () {} },
        playSong: Object.assign(function () {}, { _ndWrapped: true }),
    });
    const c2 = withWrapper._calWizardChallengeReady();
    assert.equal(c2.ready, true);
    assert.equal(c2.ndFunctional, true);
    assert.deepEqual(c2.missing, []);
});

// ── source-level wiring contracts ────────────────────────────────────────────

test('the manual per-string check UI is fully removed', () => {
    for (const gone of [
        'nd-cal-check-note',
        'nd-cal-run-all-strings',
        'Check All Remaining Strings',
        '_calWizardStartNoteCapture',
        '_calWizardActiveNoteCapture',
        '_calWizardStartAllStringsRun',
        '_calWizardStopAllStringsRun',
        '_calWizardAdvanceAllStringsRun',
        '_CAL_WIZARD_NOTE_CHECK_DEFS',
        'allStrings',
    ]) {
        assert.ok(!SRC.includes(gone), 'removed wiring must not linger: ' + gone);
    }
});

test('the notes step renders one live row per string and auto-detects on tick', () => {
    assert.ok(SRC.includes('} else if (step === 4) {'), 'notes step renders at step 4');
    assert.ok(SRC.includes('const noteSpecs = _calWizardResolveNoteChecks();'));
    assert.ok(SRC.includes('data-note-result='), 'per-string live result rows');
    assert.ok(SRC.includes('_calWizardAutoDetectStrings(snap);'), 'refresh tick drives auto-detection');
    assert.ok(SRC.includes('const _CAL_WIZARD_STRING_AUTO_TICKS = 3;'));
    assert.ok(SRC.includes('like a tuner'), 'the step explains the tuner-style flow');
});

test('the wizard polls plugin status while open and stops on close', () => {
    assert.ok(SRC.includes('_calWizardPluginTickStart();'), 'poll starts with the wizard');
    assert.ok(SRC.includes('_calWizardPluginTickStop();'), 'poll stops on close');
    assert.ok(SRC.includes("fetch('/api/plugins')"), 'poll reads /api/plugins');
    assert.ok(SRC.includes("fetch('/api/startup-status')"), 'poll reads the global progress counter');
});

test('Next is blocked while a required plugin is not ready', () => {
    assert.ok(SRC.includes('nextBtn.disabled = true;'), 'Next disabled while waiting');
    assert.ok(SRC.includes("'Waiting for plugins…'"), 'the wait is explained to the user');
    assert.ok(SRC.includes('nd-cal-plugin-wait'), 'a status banner names the missing plugins');
});

test('the apply step gates Apply/Finish on challenge readiness', () => {
    assert.ok(SRC.includes("step === 8 && challenge && !challenge.ready"), 'final check on the apply step');
    assert.ok(SRC.includes("body.querySelector('.nd-cal-apply-safe')"), 'Apply waits for readiness');
    assert.ok(SRC.includes("body.querySelector('.nd-cal-finish-no-apply')"), 'Finish waits for readiness');
});

test('the ready step gates the challenge and offers a bounded override', () => {
    assert.ok(SRC.includes('} else if (step === 7) {'), 'ready step renders at step 7');
    assert.ok(SRC.includes('nd-cal-ready-override'), 'override button after a bounded wait');
    assert.ok(SRC.includes('pluginWaitOverride = true'), 'override lifts the gate');
    assert.ok(SRC.includes('_calWizardChallengeReady()'), 'final challenge check runs');
});
