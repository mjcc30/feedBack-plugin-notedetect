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

test('wizard has 8 steps and no tuner step', () => {
    const steps = wizardSteps();
    assert.deepEqual(steps.map((s) => s.id),
        ['welcome', 'audio', 'noise', 'signal', 'notes', 'timing', 'review', 'apply']);
    assert.ok(!steps.some((s) => s.id === 'tuner'), 'tuner step must be gone');
    assert.ok(!SRC.includes("id: 'tuner'"), 'no tuner step id anywhere in the step list');
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
    wiz.step = 3;
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
