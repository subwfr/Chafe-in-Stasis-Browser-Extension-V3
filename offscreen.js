let audioCtx, source, globalDryGain, globalWetGain, masterGain, hardLimiterNode;
let workletNode, folderNode, clipperNode, vibratoLFO, vibratoAmountGain, delayNode;
let lpfNodes = [], revInGain, revOutGain, convolver, dryGain, wetGain;
let dspModules = {}, currentOrder = [], currentBypasses = {};

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'PROCESS_STREAM') {
    navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } } }).then(async (stream) => {
      audioCtx = new AudioContext();
      await audioCtx.audioWorklet.addModule('processor.js');
      source = audioCtx.createMediaStreamSource(stream);

      globalDryGain = audioCtx.createGain(); globalWetGain = audioCtx.createGain(); masterGain = audioCtx.createGain();
      globalDryGain.gain.value = 0.0; globalWetGain.gain.value = 1.0; masterGain.gain.value = 1.0;

      hardLimiterNode = audioCtx.createWaveShaper();
      const lc = new Float32Array(8192);
      for (let i = 0; i < 8192; i++) lc[i] = Math.max(-1.0, Math.min(1.0, (i * 2) / 8192 - 1));
      hardLimiterNode.curve = lc;

      workletNode = new AudioWorkletNode(audioCtx, 'dsp-processor');
      folderNode = audioCtx.createWaveShaper(); folderNode.oversample = '4x';
      clipperNode = audioCtx.createWaveShaper(); clipperNode.oversample = '4x'; 
      folderNode.connect(clipperNode);

      delayNode = audioCtx.createDelay(1.0); delayNode.delayTime.value = 0.05; 
      vibratoLFO = audioCtx.createOscillator(); vibratoLFO.type = 'sine'; vibratoLFO.start();
      vibratoAmountGain = audioCtx.createGain(); vibratoAmountGain.gain.value = 0.0;
      vibratoLFO.connect(vibratoAmountGain); vibratoAmountGain.connect(delayNode.delayTime);

      lpfNodes = [];
      for (let i = 0; i < 4; i++) { 
        const bq = audioCtx.createBiquadFilter(); 
        bq.type = 'lowpass'; bq.frequency.value = 20000; bq.Q.value = 0.707; // Flat response
        lpfNodes.push(bq); 
      }
      lpfNodes[0].connect(lpfNodes[1]); lpfNodes[1].connect(lpfNodes[2]); lpfNodes[2].connect(lpfNodes[3]);

      revInGain = audioCtx.createGain(); revOutGain = audioCtx.createGain(); convolver = audioCtx.createConvolver();
      dryGain = audioCtx.createGain(); wetGain = audioCtx.createGain(); generateReverbImpulse(1.0, 1.0);
      revInGain.connect(dryGain); revInGain.connect(convolver); convolver.connect(wetGain);
      dryGain.connect(revOutGain); wetGain.connect(revOutGain);

      dspModules = {
        redux: { in: workletNode, out: workletNode },
        distortion: { in: folderNode, out: clipperNode },
        vibrato: { in: delayNode, out: delayNode },
        filter: { in: lpfNodes[0], out: lpfNodes[3] },
        reverb: { in: revInGain, out: revOutGain }
      };

      currentOrder = ['redux', 'distortion', 'vibrato', 'filter', 'reverb'];
      rebuildChain(currentOrder, {});
      const track = stream.getAudioTracks()[0]; track.enabled = true;
    });
  }
  
  if (message.type === 'UPDATE_ENGINE') {
    const p = message.params;
    
    // Logic for 0 Slope bypassing
    const activeBypasses = {...message.bypasses};
    if (p.lpfSlope === 0) activeBypasses['filter'] = false;

    if (JSON.stringify(currentOrder) !== JSON.stringify(message.order) || JSON.stringify(currentBypasses) !== JSON.stringify(activeBypasses)) {
        currentOrder = message.order; currentBypasses = activeBypasses; rebuildChain(currentOrder, currentBypasses);
    }
    
    if (vibratoLFO) vibratoLFO.frequency.value = p.rate;
    applySAndH(p.random, p.amount);
    if (convolver) {
      generateReverbImpulse(p.revSize, p.revDecay);
      wetGain.gain.setTargetAtTime(p.revWet * (p.revMix / 100), audioCtx.currentTime, 0.05);
      dryGain.gain.setTargetAtTime(1.0 - (p.revMix / 100), audioCtx.currentTime, 0.05);
    }
    updateFC(p.folder, p.clip);
    
    if (lpfNodes.length === 4 && p.lpfSlope > 0) {
      let stages = Math.min(4, Math.ceil(p.lpfSlope / 12));
      for (let i = 0; i < 4; i++) {
        const targetFreq = i < stages ? p.lpfCut : 24000;
        lpfNodes[i].frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.05);
      }
    }

    if (workletNode) {
      workletNode.parameters.get('bitDepth').value = p.bit; 
      // Map Hz bitrate back to sample division for the worklet
      const srDiv = Math.max(1, Math.round(audioCtx.sampleRate / p.down));
      workletNode.parameters.get('downsample').value = srDiv;
      workletNode.parameters.get('reverse').value = message.reverse; 
      workletNode.parameters.get('stutter').value = message.stutter;
    }
    if (masterGain) {
      globalWetGain.gain.setTargetAtTime(p.globalMix / 100, audioCtx.currentTime, 0.05);
      globalDryGain.gain.setTargetAtTime(1.0 - (p.globalMix / 100), audioCtx.currentTime, 0.05);
      masterGain.gain.setTargetAtTime(p.outGain, audioCtx.currentTime, 0.05);
    }
  }
});

function rebuildChain(order, bypasses) {
  if (!source) return;
  source.disconnect();
  for (const k in dspModules) dspModules[k].out.disconnect();
  source.connect(globalDryGain); globalDryGain.connect(masterGain);
  let out = source;
  order.forEach(m => { if (dspModules[m] && bypasses[m] !== false) { out.connect(dspModules[m].in); out = dspModules[m].out; } });
  out.connect(globalWetGain); globalWetGain.connect(masterGain);
  masterGain.connect(hardLimiterNode); hardLimiterNode.connect(audioCtx.destination);
}

let rTimer;
function applySAndH(hz, amt) {
  if (rTimer) clearInterval(rTimer);
  if (vibratoAmountGain) vibratoAmountGain.gain.cancelScheduledValues(audioCtx.currentTime);
  const m = amt / 10000;
  if (hz === 0) { if (vibratoAmountGain) vibratoAmountGain.gain.setValueAtTime(m, audioCtx.currentTime); return; }
  rTimer = setInterval(() => {
    vibratoAmountGain.gain.setValueAtTime(vibratoAmountGain.gain.value, audioCtx.currentTime);
    vibratoAmountGain.gain.linearRampToValueAtTime(Math.random() * m, audioCtx.currentTime + 0.1);
  }, 1000 / hz);
}

function generateReverbImpulse(s, d) {
  if (!audioCtx) return;
  const sr = audioCtx.sampleRate, l = Math.max(1, Math.floor(sr * s)), imp = audioCtx.createBuffer(2, l, sr);
  for (let c = 0; c < 2; c++) { const dat = imp.getChannelData(c); for (let i = 0; i < l; i++) dat[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / l, d * 5); }
  convolver.buffer = imp;
}

function updateFC(fP, cP) {
  const cL = 4096, fC = new Float32Array(cL), cC = new Float32Array(cL), fd = fP / 100, f = 1 + (fd * 5), k = (cP / 100) * 50.0;
  for (let i = 0; i < cL; i++) {
    let x = (i * 2) / cL - 1;
    fC[i] = (x * (1 - fd)) + (Math.sin(x * (Math.PI / 2) * f) * fd);
    cC[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  // True Bypass: Remove curve entirely if parameter is 0 to stop interpolator artificing
  folderNode.curve = fP === 0 ? null : fC; 
  clipperNode.curve = cP === 0 ? null : cC;
}