class DSPProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 16, minValue: 1, maxValue: 16 },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 41 },
      { name: 'reverse', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'stutter', defaultValue: 0, minValue: 0, maxValue: 1 }
    ];
  }

  constructor() {
    super();
    this.bufferSize = 48000 * 2; 
    this.reverseBuffer = [new Float32Array(this.bufferSize), new Float32Array(this.bufferSize)];
    this.writePointer = 0;
    this.sampleHoldCounter = 0;
    this.heldSamples = [0, 0];
    this.wasReversing = false;
    this.reverseHead = 0;
    this.wasStuttering = false;
    this.stutterLoopLength = 2048; 
    this.stutterHead = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const bitDepth = parameters.bitDepth[0];
    const downsample = Math.floor(parameters.downsample[0]);
    const isReversing = parameters.reverse[0] === 1;
    const isStuttering = parameters.stutter[0] === 1;
    const bitSteps = Math.pow(2, bitDepth);

    if (isReversing && !this.wasReversing) {
        this.reverseHead = this.writePointer - 1;
        if (this.reverseHead < 0) this.reverseHead += this.bufferSize;
    }
    this.wasReversing = isReversing;

    if (isStuttering && !this.wasStuttering) {
        this.stutterHead = this.writePointer - this.stutterLoopLength;
        if (this.stutterHead < 0) this.stutterHead += this.bufferSize;
    }
    this.wasStuttering = isStuttering;

    const numChannels = input.length;
    const numSamples = input[0].length;

    for (let i = 0; i < numSamples; i++) {
      const currentWriteIdx = (this.writePointer + i) % this.bufferSize;
      
      this.sampleHoldCounter++;
      const shouldUpdateHold = this.sampleHoldCounter >= downsample;

      for (let channel = 0; channel < numChannels; channel++) {
        let sample = input[channel][i];
        const bufferChannel = this.reverseBuffer[channel] || this.reverseBuffer[0];

        if (!isStuttering) {
            bufferChannel[currentWriteIdx] = sample;
        }

        if (isStuttering) {
            sample = bufferChannel[this.stutterHead];
        } 
        else if (isReversing) {
            sample = bufferChannel[this.reverseHead];
        }

        if (shouldUpdateHold) {
          this.heldSamples[channel] = Math.round(sample * bitSteps) / bitSteps;
        }

        if (output[channel]) {
            output[channel][i] = this.heldSamples[channel];
        }
      }

      if (shouldUpdateHold) {
         this.sampleHoldCounter = 0;
      }

      if (isStuttering) {
         this.stutterHead++;
         if (this.stutterHead >= (this.writePointer || this.bufferSize)) {
             this.stutterHead -= this.stutterLoopLength;
         }
      } else if (isReversing) {
         this.reverseHead--;
         if (this.reverseHead < 0) this.reverseHead += this.bufferSize;
      }
    }

    if (!isStuttering) {
        this.writePointer = (this.writePointer + numSamples) % this.bufferSize;
    }
    return true;
  }
}

registerProcessor('dsp-processor', DSPProcessor);