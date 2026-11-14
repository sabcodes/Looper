const $ = (id) => document.getElementById(id);
const pretty = (value) => String(value ?? 'Default').replaceAll('_', ' ');
const clock = (seconds) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
let selectedFile = null;
let blueprintPrompt = null;
let editor = null;
let busy = '';
let auditionURL = null;
const trackURL = (name) => 'beat://audio/' + encodeURIComponent(name);
const liquidHint = 'Optional. Ask the local Liquid model to preview an alternate style.';
const liquidStatus = (message) => { $('liquid-status').textContent = message; };

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function request(action) {
  const prompt = $('prompt').value;
  let options = {};
  if ($('engine-options').value.trim()) {
    try { options = JSON.parse($('engine-options').value); }
    catch { throw new Error('Additional engine options must be valid JSON.'); }
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Additional engine options must be a JSON object.');
  }
  options.seed = $('seed').value;
  for (const [id, key] of [['sound-seed', 'soundSeed'], ['phrase-seed', 'phraseSeed']]) if ($(id).value.trim()) options[key] = $(id).value;
  if (!$('auto-sauce').checked) options.sauce = Number($('sauce').value);
  if ($('lyrics').value.trim()) {
    options.lyrics = $('lyrics').value;
    options.voice = $('voice').value;
    if ($('hook').value.trim()) options.hook = $('hook').value;
  }
  if (prompt.trim() === blueprintPrompt) {
    const direction = $('direction').value;
    if (direction) options.intentOverride = direction;
    else delete options.intentOverride;
  }
  if (action !== 'generate') return { prompt, options };
  return { prompt, options, format: $('format').value, output: $('output').value.trim(), stems: $('stems').checked, saveScore: $('save-score').checked };
}

function showBlueprint(s, prompt) {
  blueprintPrompt = prompt?.trim() ?? null;
  $('blueprint-empty').hidden = true;
  $('blueprint').hidden = false;
  $('style').textContent = pretty(s.intent);
  $('tempo').textContent = s.bpm;
  $('key').textContent = s.key;
  $('duration').textContent = clock(s.duration);
  $('structure').textContent = s.bars + ' bars · ' + s.meter + ' · ' + s.duration.toFixed(2) + ' seconds';
  $('sections').replaceChildren(...s.sections.map((section) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = section.name;
    button.title = pretty(section.name) + ' · bars ' + (section.start + 1) + '–' + section.end;
    // Seeking uses the blueprint only when it belongs to the loaded render.
    button.disabled = true;
    button.dataset.time = section.startTime;
    return button;
  }));
  $('sounds').replaceChildren(...Object.entries(s.sounds).flatMap(([role, sound]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = role; dd.textContent = pretty(sound);
    return [dt, dd];
  }));
  $('seed-info').textContent = 'Music ' + s.seed + ' / Sound ' + s.soundSeed + ' / Phrase ' + s.phraseSeed + ' / Sauce ' + s.sauce;
  const source = { explicit: 'Named in prompt', context: 'Inferred from cues', inferred: 'Inferred from wording',
    default: 'Style unresolved', locked: 'Style locked' };
  $('interpretation').textContent = source[s.interpretation] + (s.cues.length ? ' · Cues — ' + s.cues.join(', ') : '');
  const directions = [...new Set([s.intent, ...s.alternatives])];
  $('direction').replaceChildren(new Option('Follow prompt', ''), ...directions.map((id) => new Option(pretty(id), id)));
  $('direction').value = s.interpretation === 'locked' ? s.intent : '';
  $('direction-control').hidden = !prompt || !s.canSuggest && s.interpretation !== 'locked';
  if (prompt && s.interpretation === 'locked') liquidStatus('Choose Follow prompt to unlock the style before asking Liquid.');
  else if (prompt && !s.canSuggest) liquidStatus('Your prompt names a style. Liquid can suggest alternatives for open-ended prompts.');
  else liquidStatus(liquidHint);
  $('messages').replaceChildren(...s.messages.map((message) => { const p = document.createElement('p'); p.textContent = message; return p; }));
}

function loadTrack(name, bytes) {
  selectedFile = name;
  $('player').pause();
  $('player').src = trackURL(name);
  $('player').load();
  if (auditionURL) URL.revokeObjectURL(auditionURL);
  auditionURL = null;
  if (editor) {
    editor.solo = null;
    editor.muted.clear();
    editor.original = false;
    showAudition();
  }
  $('now-playing').textContent = name;
  $('file-info').textContent = bytes ? (bytes / 1024 / 1024).toFixed(1) + ' MB · ' + name.split('.').at(-1).toUpperCase() : 'Saved in generated_beats/';
  $('playback-error').textContent = '';
  $('reveal').disabled = false;
  $('edit-parts').disabled = false;
  for (const button of $('sections').children) button.disabled = true;
  for (const button of $('library').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.file === name));
}

async function refreshLibrary() {
  const files = await window.beats.library();
  $('library-count').textContent = files.length;
  $('library').replaceChildren(...files.map((file) => {
    const li = document.createElement('li'), button = document.createElement('button');
    const icon = document.createElement('span'), name = document.createElement('span'), size = document.createElement('small');
    icon.className = 'track-icon'; icon.textContent = '▷'; icon.setAttribute('aria-hidden', 'true');
    name.className = 'track-name'; name.textContent = file.name;
    size.textContent = (file.bytes / 1024 / 1024).toFixed(1) + ' MB';
    button.type = 'button'; button.title = file.name; button.dataset.file = file.name;
    button.setAttribute('aria-current', String(selectedFile === file.name));
    button.append(icon, name, size); button.addEventListener('click', () => { if (!busy) loadTrack(file.name, file.bytes); });
    li.append(button); return li;
  }));
  if (!files.length) { const li = document.createElement('li'); li.textContent = 'No renders yet. Make the first one.'; li.className = 'hint'; $('library').append(li); }
}

async function run(action) {
  const suggesting = action === 'suggest';
  if (busy) {
    if (suggesting && busy !== 'suggest') liquidStatus('Wait for the current job to finish, then ask Liquid.');
    return;
  }
  if (!suggesting && !$('composer').reportValidity()) return;
  const controls = [...$('composer').querySelectorAll('input,textarea,select,button'), $('direction'), $('suggest')];
  const disabled = controls.map((c) => c.disabled);
  try {
    if (suggesting && !$('seed').value.trim()) throw new Error('Enter a musical seed before asking Liquid.');
    const input = request(action);
    busy = suggesting ? 'suggest' : 'compose';
    if (!suggesting) document.body.setAttribute('aria-busy', 'true');
    controls.forEach((c) => { c.disabled = true; });
    status(action === 'generate' ? 'Starting local render…' : 'Reading your prompt…');
    if (suggesting) liquidStatus('Checking the prompt for alternatives…');
    const result = await window.beats[action](input);
    showBlueprint(result.summary, input.prompt);
    if (action === 'generate') {
      await refreshLibrary();
      loadTrack(result.filename);
      for (const button of $('sections').children) button.disabled = false;
      status('Saved ' + result.files.length + ' file' + (result.files.length === 1 ? '' : 's') + '. Ready to play.');
    } else {
      if (suggesting && result.suggestion) {
        liquidStatus('Preparing the Liquid suggestion…');
        const { summary } = await window.beats.preview({ ...input, options: { ...input.options, intentOverride: result.suggestion } });
        showBlueprint(summary, input.prompt);
        liquidStatus('Previewing Liquid’s suggestion: ' + pretty(result.suggestion) + '. Choose Follow prompt to go back.');
      } else if (suggesting) liquidStatus(result.note);
      status('Arrangement ready. Generate to render this beat.');
    }
  } catch (error) {
    const message = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    if (suggesting) liquidStatus(message);
    status(message, true);
  }
  finally {
    busy = '';
    document.body.removeAttribute('aria-busy');
    controls.forEach((c, i) => { c.disabled = disabled[i]; });
  }
}

const editorStatus = (message) => { $('part-status').textContent = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); };
const selectedTrack = () => editor.tracks.find((track) => track.id === $('edit-part').value);
const eventFields = ['bar', 'offset', 'note', 'velocity', 'duration'];
const shownNumber = (value) => Number(value.toFixed(6));
const staged = () => [...editor.updates.values(), ...editor.copies];
const hasStagedChanges = () => staged().length > 0 || editor.variations.size > 0;
const eventKey = (track, index) => track.id + '/' + index;

function showAudition() {
  const { source, tracks, solo, muted, variations, original } = editor;
  $('audition').hidden = source !== selectedFile || !tracks.length;
  $('full-mix').disabled = solo === null && !muted.size && (!variations.size || Boolean(auditionURL));
  const pending = busy === 'audition';
  const part = tracks.find((track) => track.id === solo);
  $('full-mix').setAttribute('aria-disabled', String(pending));
  for (const button of $('audition-parts').querySelectorAll('button')) {
    const { mode, track } = button.dataset;
    button.setAttribute('aria-pressed', String(mode === 'solo' ? solo === track : muted.has(track)));
    button.setAttribute('aria-disabled', String(pending));
  }
  let message = 'Full mix. Audition controls use the saved score.';
  if (pending) message = 'Rendering audition…';
  else if (part) message = pretty(part.name) + ' soloed. Mutes apply when Solo is off.';
  else if (muted.size) message = muted.size + (muted.size === 1 ? ' part muted.' : ' parts muted.');
  else if (variations.size) message = auditionURL ? 'Full mix with staged variations.' : 'Saved mix. Choose Full mix to hear staged variations.';
  $('audition-status').textContent = message;
  $('part-variation').hidden = solo === null;
  $('variation-mode').querySelector('option[value="key"]').disabled = !part?.pitched;
  const current = variations.get(solo);
  $('part-variation').disabled = pending;
  $('variation-original').disabled = $('variation-discard').disabled = !current;
  $('variation-original').setAttribute('aria-pressed', String(original));
  let variationSummary = 'Each preview starts from the saved part.';
  if (current) {
    variationSummary = (original ? 'Original selected. ' : 'Variation selected. ')
      + (current.interpretation ? 'Liquid interpreted this as “' + pretty(current.interpretation) + '”.'
        : current.mode === 'prompt' ? 'Prompt staged for this part.' : 'Seed ' + current.seed + ' staged for this part.');
  } else if (part?.savedSeed && editor.variationSource) {
    const mode = { sauce: 'Sauce', rhythm: 'Rhythm', sound: 'Instrument', key: 'Key', phrase: part.pitched ? 'Phrase' : 'Rhythm', both: 'Sound and phrase' }[part.savedMode];
    variationSummary = 'Saved from ' + editor.variationSource + ' with seed ' + part.savedSeed + (mode ? ' (' + mode + ').' : '.');
  }
  const parameters = !original && current?.parameters || part?.parameters;
  if (parameters) {
    variationSummary += ' Instrument: ' + pretty(parameters.instrument) + '.';
    if (parameters.key) variationSummary += ' Part key: ' + parameters.key.rootName + ' ' + pretty(parameters.key.scale) + '.';
  }
  $('variation-summary').textContent = variationSummary;
}

function switchAuditionAudio(nextURL) {
  const player = $('player');
  const time = player.currentTime;
  const playing = !player.paused && !player.ended;
  player.src = nextURL ?? trackURL(selectedFile);
  player.load();
  player.currentTime = time;
  if (auditionURL) URL.revokeObjectURL(auditionURL);
  auditionURL = nextURL;
  $('playback-error').textContent = '';
  if (playing) player.play().catch((error) => {
    if (error.name !== 'AbortError') $('playback-error').textContent = error.message;
  });
}

async function updateAudition(changes, failureStatus = 'audition-status', interpretPrompt = false) {
  if (busy || !editor || editor.source !== selectedFile) return;
  const { solo, muted, variations, original } = { ...editor, ...changes };
  $('variation-error').textContent = '';
  let failure;
  try {
    const preview = [...variations.values()].filter(({ track }) => solo === null ? !muted.has(track) : !original && track === solo);
    if (solo === null && !muted.size && !preview.length) {
      if (auditionURL) switchAuditionAudio(null);
    } else {
      busy = 'audition';
      showAudition();
      if (interpretPrompt) $('variation-summary').textContent = 'Checking the part prompt…';
      const { source, revision } = editor;
      const { wav, interpretation, parameters } = await window.beats.audition({ source, revision, solo, muted: [...muted], variations: preview, interpretPrompt });
      switchAuditionAudio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
      if (interpretation) variations.set(solo, { ...variations.get(solo), interpretation });
      if (parameters && variations.has(solo) && !original) variations.set(solo, { ...variations.get(solo), parameters });
    }
    const previousSolo = editor.solo;
    Object.assign(editor, { solo, muted, variations, original });
    if (solo !== previousSolo && solo !== null) {
      const part = editor.tracks.find((track) => track.id === solo);
      const variation = variations.get(solo);
      $('variation-title').textContent = 'Vary ' + pretty(part.name);
      const savedMode = variation?.mode ?? part.savedMode;
      $('variation-mode').value = ['sauce', 'rhythm', 'sound', 'key'].includes(savedMode) ? savedMode : 'sauce';
      $('variation-seed').value = variation?.seed ?? part.savedSeed ?? '';
      $('variation-prompt').value = variation?.prompt ?? '';
      $('variation-prompt').placeholder = part.pitched ? 'Use a piano, or change the key to D minor' : 'Try a syncopated rhythm';
      if ($('edit-part').value !== solo) {
        $('edit-part').value = solo;
        chooseTrack();
      }
    }
    showEditCount();
    return true;
  } catch (error) {
    failure = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  } finally {
    busy = '';
    showAudition();
    if (failure) $(failureStatus).textContent = failure;
  }
}

function setAudition(mode, track) {
  if (busy || !editor || editor.source !== selectedFile) return;
  if (mode === 'full') return updateAudition({ solo: null, muted: new Set(), original: false });
  if (mode === 'solo') return updateAudition({ solo: editor.solo === track ? null : track, original: false });
  const muted = new Set(editor.muted);
  if (!muted.delete(track)) muted.add(track);
  if (editor.solo === null) return updateAudition({ muted });
  editor.muted = muted;
  showAudition();
}

function previewVariation(mode) {
  if (busy || !editor?.solo || editor.source !== selectedFile) return;
  const track = editor.solo;
  const variations = new Map(editor.variations);
  if (mode === 'discard') {
    variations.delete(track);
  } else if (mode === 'prompt') {
    variations.set(track, { track, mode, prompt: $('variation-prompt').value.trim() });
  } else {
    if (mode === 'reroll') $('variation-seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    variations.set(track, { track, mode: $('variation-mode').value, seed: $('variation-seed').value.trim() });
  }
  return updateAudition({ variations, original: false }, 'variation-error', mode === 'prompt' && $('variation-liquid').checked);
}

function listAuditionParts(tracks) {
  $('audition-parts').replaceChildren(...tracks.map(({ id, name }) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = pretty(name);
    row.append(label);
    for (const [mode, title] of [['solo', 'Solo'], ['mute', 'Mute']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = title;
      button.dataset.mode = mode;
      button.dataset.track = id;
      button.setAttribute('aria-label', title + ' ' + label.textContent);
      button.addEventListener('click', () => setAudition(mode, id));
      row.append(button);
    }
    return row;
  }));
  showAudition();
}

function showEditCount() {
  const count = staged().length + editor.variations.size;
  $('edit-count').textContent = count ? count + (count === 1 ? ' staged change' : ' staged changes') : 'Choose a note or hit. Duplicate it to add another.';
  $('save-edits').disabled = $('clear-edits').disabled = !count;
}

function showEventFields() {
  const track = selectedTrack();
  const index = $('edit-event').value;
  $('event-fields').disabled = index === '';
  $('event-note-label').hidden = $('event-note').disabled = !track?.pitched;
  if (index === '') return;
  const edit = editor.updates.get(eventKey(track, index));
  const event = { ...track.events[Number(index)], ...edit };
  $('remove-event').disabled = edit?.action === 'remove';
  for (const field of eventFields) {
    const value = event[field];
    $('event-' + field).value = value === undefined ? '' : field === 'bar' ? value + 1 : shownNumber(value);
  }
}

function listEvents() {
  const track = selectedTrack();
  const bar = Number($('find-bar').value);
  const previous = $('edit-event').value;
  const choices = track?.events.flatMap((event, index) => {
    if (event.bar !== bar) return [];
    const action = editor.updates.get(eventKey(track, index))?.action;
    const label = 'Step ' + shownNumber(event.offset) + (track.pitched ? ' · MIDI ' + event.note : '')
      + (action === 'remove' ? ' · remove' : action ? ' · edited' : '');
    return [new Option(label, index)];
  }) ?? [];
  $('edit-event').replaceChildren(...(choices.length ? choices : [new Option('No events in this bar', '')]));
  if (choices.some((choice) => choice.value === previous)) $('edit-event').value = previous;
  showEventFields();
}

function chooseTrack() {
  const track = selectedTrack();
  if (track) $('find-bar').value = track.events[0].bar;
  $('edit-event').value = '';
  listEvents();
}

async function openEditor() {
  if (busy || !selectedFile) return;
  if (editor && hasStagedChanges()) { editorStatus('Render or clear the staged edits before opening another score.'); return; }
  const source = selectedFile;
  busy = 'edit';
  try {
    const data = await window.beats.inspectScore(source);
    if (auditionURL) switchAuditionAudio(null);
    editor = { source, ...data, updates: new Map(), copies: [], solo: null, muted: new Set(), original: false, variations: new Map() };
    $('parts-editor').hidden = false;
    $('edit-source').textContent = source;
    $('edit-part').replaceChildren(...data.tracks.map((track) => new Option(pretty(track.name), track.id)));
    listAuditionParts(data.tracks);
    $('find-bar').replaceChildren(...data.bars.map((steps, bar) => new Option('Bar ' + (bar + 1) + ' · ' + steps + ' steps', bar)));
    $('event-bar').max = data.bars.length;
    chooseTrack();
    showEditCount();
    editorStatus(data.tracks.length ? 'Editing a copy of the saved score.' : 'This score has no editable notes or hits.');
  } catch (error) { editorStatus(error.message); }
  finally { busy = ''; }
}

function stageEvent(action) {
  if (busy || !editor || $('edit-event').value === '') return;
  const track = selectedTrack();
  const index = Number($('edit-event').value);
  const original = track.events[index];
  const key = eventKey(track, index);
  const edit = { action, track: track.id, index };
  if (action !== 'remove') {
    if (!$('parts-editor').reportValidity()) return;
    for (const field of eventFields) {
      if (original[field] === undefined) continue;
      const value = $('event-' + field).valueAsNumber - (field === 'bar' ? 1 : 0);
      if (value !== shownNumber(original[field])) edit[field] = value;
    }
    const bar = edit.bar ?? original.bar;
    if ((edit.offset ?? original.offset) >= editor.bars[bar]) { editorStatus('Choose a step within bar ' + (bar + 1) + '.'); return; }
  }
  if (action === 'duplicate') editor.copies.push(edit);
  else if (action === 'remove' || Object.keys(edit).length > 3) editor.updates.set(key, edit);
  else editor.updates.delete(key);
  listEvents();
  showEditCount();
  editorStatus('Staged edits will apply when you render the copy.');
}

async function saveEdits(event) {
  event.preventDefault();
  if (busy || !editor || !hasStagedChanges()) return;
  busy = 'edit';
  $('parts-editor').inert = true;
  try {
    editorStatus('Rendering edited copy…');
    const result = await window.beats.renderEdit({ source: editor.source, revision: editor.revision,
      edits: staged(), variations: [...editor.variations.values()] });
    editor = null;
    $('parts-editor').hidden = true;
    showBlueprint(result.summary);
    loadTrack(result.filename);
    for (const button of $('sections').children) button.disabled = false;
    editorStatus('Saved ' + result.filename + ' and its score. Open the selected score to keep editing.');
    await refreshLibrary();
  } catch (error) { editorStatus(error.message); }
  finally { $('parts-editor').inert = false; busy = ''; }
}

$('edit-parts').addEventListener('click', openEditor);
$('full-mix').addEventListener('click', () => setAudition('full'));
$('variation-reroll').addEventListener('click', () => previewVariation('reroll'));
$('variation-preview').addEventListener('click', () => previewVariation('seed'));
$('variation-apply').addEventListener('click', () => previewVariation('prompt'));
$('variation-original').addEventListener('click', () => { if (editor?.variations.has(editor.solo)) return updateAudition({ original: !editor.original }); });
$('variation-discard').addEventListener('click', () => previewVariation('discard'));
for (const mode of ['seed', 'prompt']) $('variation-' + mode).addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); return previewVariation(mode); }
});
$('edit-part').addEventListener('change', chooseTrack);
$('find-bar').addEventListener('change', listEvents);
$('edit-event').addEventListener('change', showEventFields);
$('stage-event').addEventListener('click', () => stageEvent('update'));
$('duplicate-event').addEventListener('click', () => stageEvent('duplicate'));
$('remove-event').addEventListener('click', () => stageEvent('remove'));
$('clear-edits').addEventListener('click', async () => {
  if (busy || !editor) return;
  if (editor.variations.size) {
    if (editor.source === selectedFile) {
      if (!await updateAudition({ solo: null, muted: new Set(), variations: new Map(), original: false })) return;
    } else editor.variations.clear();
  }
  editor.updates.clear();
  editor.copies.length = 0;
  listEvents();
  showEditCount();
  editorStatus('Staged edits cleared.');
});
$('parts-editor').addEventListener('submit', saveEdits);
$('composer').addEventListener('submit', (e) => { e.preventDefault(); run('generate'); });
$('inspect').addEventListener('click', () => run('preview'));
$('suggest').addEventListener('click', () => run('suggest'));
$('direction').addEventListener('change', () => run('preview'));
function clearDirectionOnPromptEdit() {
  if ($('prompt').value.trim() === blueprintPrompt) return;
  blueprintPrompt = null;
  $('direction-control').hidden = true;
  liquidStatus(liquidHint);
}
$('prompt').addEventListener('input', clearDirectionOnPromptEdit);
$('reroll').addEventListener('click', () => { $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0]; });
$('reroll-sound').addEventListener('click', () => { $('sound-seed').value = crypto.getRandomValues(new Uint32Array(1))[0]; });
function updateSauce() {
  $('sauce').disabled = $('auto-sauce').checked;
  $('sauce-value').textContent = $('auto-sauce').checked ? 'Genre default' : Number($('sauce').value).toFixed(2);
}
$('auto-sauce').addEventListener('change', updateSauce);
$('sauce').addEventListener('input', updateSauce);
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => {
  $('prompt').value = button.dataset.prompt;
  clearDirectionOnPromptEdit();
  $('prompt').focus();
});
$('refresh').addEventListener('click', () => refreshLibrary().catch((e) => status(e.message, true)));
$('reveal').addEventListener('click', () => window.beats.reveal(selectedFile).catch((e) => status(e.message, true)));
$('sections').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button && !button.disabled) { $('player').currentTime = Number(button.dataset.time); $('player').play().catch((e) => status(e.message, true)); }
});
$('player').addEventListener('error', () => {
  $('playback-error').textContent = auditionURL ? 'Audition playback unavailable. Select the saved render again to restore playback.'
    : 'Playback unavailable for this file. Use Show file to open it in your audio player.';
});
window.beats.onStage((stage) => {
  const message = stage + '…';
  if (busy === 'suggest') {
    if (stage !== 'Interpreting prompt') liquidStatus(message);
  } else if (busy === 'audition') $('variation-summary').textContent = message;
  else if (busy === 'edit') editorStatus(message);
  else status(message);
});
async function initialize() {
  const info = await window.beats.info();
  $('library-location').textContent = 'Latest 50 audio files in your beats folder';
  $('library-location').title = info.outputDirectory;
  status('Ready when you are. Files stay in your beats folder.');
  await refreshLibrary();
}
initialize().catch((error) => status(error.message, true));
