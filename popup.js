const paramConfig = {
  bit: { min: 1, max: 16, step: 1, log: false, default: 16 },
  down: { min: 100, max: 48000, step: 1, log: true, default: 48000 },
  folder: { min: 0, max: 100, step: 1, log: false, default: 0 },
  clip: { min: 0, max: 100, step: 1, log: false, default: 0 },
  rate: { min: 0.5, max: 20, step: 0.1, log: false, default: 5 },
  amount: { min: 0, max: 100, step: 1, log: false, default: 0 },
  random: { min: 0, max: 20, step: 0.1, log: false, default: 0 },
  lpfCut: { min: 20, max: 20000, step: 1, log: true, default: 20000 },
  lpfSlope: { min: 0, max: 48, step: 12, log: false, default: 0 },
  revSize: { min: 0.1, max: 4.0, step: 0.1, log: false, default: 1.0 },
  revDecay: { min: 0.1, max: 4.0, step: 0.1, log: false, default: 1.0 },
  revWet: { min: 0, max: 2.0, step: 0.05, log: false, default: 1.0 },
  revMix: { min: 0, max: 100, step: 1, log: false, default: 0 },
  globalMix: { min: 0, max: 100, step: 1, log: false, default: 100 },
  outGain: { min: 0, max: 2.0, step: 0.05, log: false, default: 1.0 }
};

let state = {};
let bypassState = {};
let isReversing = 0, isStuttering = 0, activeKnob = null, startY = 0, startVal = 0;

document.querySelectorAll('.drag-handle').forEach(handle => {
  const rackUnit = handle.parentElement;
  handle.addEventListener('mousedown', () => rackUnit.setAttribute('draggable', 'true'));
  handle.addEventListener('mouseup', () => rackUnit.removeAttribute('draggable'));
  handle.addEventListener('mouseleave', () => rackUnit.removeAttribute('draggable'));
});

let draggedItem = null;
document.querySelectorAll('.rack-unit').forEach(unit => {
  unit.addEventListener('dragstart', function() {
    draggedItem = this;
    setTimeout(() => this.classList.add('dragging'), 0);
  });
  unit.addEventListener('dragend', function() {
    this.classList.remove('dragging');
    this.removeAttribute('draggable');
    draggedItem = null;
    transmitState(); 
  });
  unit.addEventListener('dragover', function(e) {
    e.preventDefault();
    if (this !== draggedItem) {
      const bounding = this.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);
      if (e.clientY - offset > 0) this.parentNode.insertBefore(draggedItem, this.nextSibling);
      else this.parentNode.insertBefore(draggedItem, this);
    }
  });
});

document.querySelectorAll('.bypass-switch').forEach(toggle => {
  toggle.addEventListener('change', (e) => {
    const unit = e.target.closest('.rack-unit');
    const modId = unit.getAttribute('data-module');
    bypassState[modId] = e.target.checked;
    if (e.target.checked) unit.classList.remove('is-bypassed');
    else unit.classList.add('is-bypassed');
    transmitState();
  });
});

function getModuleOrder() {
  return Array.from(document.querySelectorAll('.rack-unit[data-module]')).map(el => el.getAttribute('data-module'));
}

function drawDistortionGraph() {
  const canvas = document.getElementById('distortionGraph');
  if(!canvas) return;
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath(); 
  ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
  ctx.strokeStyle = '#4A90E2'; ctx.lineWidth = 2; ctx.beginPath();
  const k = (state.clip / 100) * 50.0, fd = state.folder / 100, f = 1.0 + (fd * 5.0);
  for(let i = 0; i < w; i++) {
    let x = (i / w) * 2 - 1; 
    let folded = (x * (1.0 - fd)) + (Math.sin(x * (Math.PI / 2.0) * f) * fd);
    let y = ((1 + k) * folded) / (1 + k * Math.abs(folded));
    let cy = (h / 2) - (y * (h / 2));
    if (i === 0) ctx.moveTo(i, cy); else ctx.lineTo(i, cy);
  }
  ctx.stroke();
}

function updateVisuals(id, val) {
  const p = paramConfig[id];
  const numBox = document.getElementById(id + 'Num');
  if (numBox) numBox.value = Number.isInteger(p.step) ? Math.round(val) : val.toFixed(2);
  const pointer = document.querySelector(`.knob[data-id="${id}"] .knob-pointer-container`);
  if (pointer) {
    let pct = p.log ? (Math.log10(val) - Math.log10(p.min)) / (Math.log10(p.max) - Math.log10(p.min)) : (val - p.min) / (p.max - p.min);
    pointer.style.transform = `rotate(${(pct * 270) - 135}deg)`;
  }
  if (id === 'folder' || id === 'clip') drawDistortionGraph();
}

document.querySelectorAll('.knob').forEach(knob => {
  knob.addEventListener('mousedown', (e) => {
    activeKnob = knob.getAttribute('data-id'); startY = e.clientY; startVal = state[activeKnob];
    document.body.style.cursor = 'ns-resize';
  });
});

document.addEventListener('mousemove', (e) => {
  if (!activeKnob) return;
  const p = paramConfig[activeKnob], delta = (startY - e.clientY) / 150;
  let nv;
  if (p.log) {
    const minL = Math.log10(p.min), maxL = Math.log10(p.max);
    nv = Math.pow(10, Math.max(minL, Math.min(maxL, Math.log10(startVal) + (delta * (maxL - minL)))));
  } else nv = Math.max(p.min, Math.min(p.max, startVal + (delta * (p.max - p.min))));
  nv = Math.round(nv * (1/p.step)) / (1/p.step);
  if (state[activeKnob] !== nv) { state[activeKnob] = nv; updateVisuals(activeKnob, nv); transmitState(); }
});

document.addEventListener('mouseup', () => { activeKnob = null; document.body.style.cursor = 'default'; });

document.querySelectorAll('.num-box').forEach(box => {
  box.addEventListener('change', (e) => {
    const id = e.target.id.replace('Num', ''), p = paramConfig[id];
    let v = parseFloat(e.target.value);
    if(isNaN(v)) v = p.default;
    v = Math.max(p.min, Math.min(p.max, Math.round(v * (1/p.step)) / (1/p.step)));
    state[id] = v; updateVisuals(id, v); transmitState();
  });
});

function loadStateToUI(ls) {
  for (const k in paramConfig) {
    state[k] = (ls && ls[k] !== undefined) ? parseFloat(ls[k]) : paramConfig[k].default;
    updateVisuals(k, state[k]);
  }
  document.querySelectorAll('.rack-unit[data-module]').forEach(unit => {
    const mid = unit.getAttribute('data-module'), sw = unit.querySelector('.bypass-switch');
    bypassState[mid] = (ls && ls.bypasses && ls.bypasses[mid] !== undefined) ? ls.bypasses[mid] : true;
    sw.checked = bypassState[mid];
    if (sw.checked) unit.classList.remove('is-bypassed'); else unit.classList.add('is-bypassed');
  });
  drawDistortionGraph(); transmitState();
}

chrome.storage.local.get(['currentState', 'presets'], (data) => {
  loadStateToUI(data.currentState || {});
  if (data.presets) {
    const s = document.getElementById('presetSelect');
    for (const n in data.presets) { const o = document.createElement('option'); o.value = n; o.innerText = n; s.appendChild(o); }
  }
});

document.getElementById('savePresetBtn').addEventListener('click', () => {
  const n = document.getElementById('presetName').value; if (!n) return;
  chrome.storage.local.get(['presets'], (data) => {
    const p = data.presets || {}; p[n] = { ...state, bypasses: { ...bypassState } };
    chrome.storage.local.set({ presets: p }, () => {
      const s = document.getElementById('presetSelect');
      if (!Array.from(s.options).some(o => o.value === n)) { const o = document.createElement('option'); o.value = n; o.innerText = n; s.appendChild(o); }
      document.getElementById('presetName').value = '';
    });
  });
});

document.getElementById('loadPresetBtn').addEventListener('click', () => {
  const n = document.getElementById('presetSelect').value; if (!n) return;
  chrome.storage.local.get(['presets'], (data) => { if (data.presets && data.presets[n]) loadStateToUI(data.presets[n]); });
});

function transmitState() {
  chrome.storage.local.set({ currentState: { ...state, bypasses: { ...bypassState } } });
  chrome.runtime.sendMessage({ type: 'UPDATE_ENGINE', params: state, order: getModuleOrder(), bypasses: bypassState, reverse: isReversing, stutter: isStuttering });
}

document.getElementById('reverseBtn').addEventListener('mousedown', () => { isReversing = 1; transmitState(); });
document.getElementById('reverseBtn').addEventListener('mouseup', () => { isReversing = 0; transmitState(); });
document.getElementById('reverseBtn').addEventListener('mouseleave', () => { isReversing = 0; transmitState(); });
document.getElementById('stutterBtn').addEventListener('mousedown', () => { isStuttering = 1; transmitState(); });
document.getElementById('stutterBtn').addEventListener('mouseup', () => { isStuttering = 0; transmitState(); });
document.getElementById('stutterBtn').addEventListener('mouseleave', () => { isStuttering = 0; transmitState(); });

document.getElementById('startBtn').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (t) => {
    chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId: t[0].id });
    setTimeout(transmitState, 100); 
  });
});