// AstroVital X live radio PCM format: 8000 Hz, unsigned 8-bit mono, 256 bytes.
export const PCM_RATE = 8000;
export const PCM_BLOCK = 256;
export const PCM_SILENCE = 128;

export function decodePcm8u(packet:Uint8Array):Float32Array {
  const out=new Float32Array(packet.length);
  for(let i=0;i<packet.length;i++)out[i]=(packet[i]-PCM_SILENCE)/128.0;
  return out;
}
export function encodePcm8u(sample:number):number {
  const limited=Number.isFinite(sample)?Math.max(-1,Math.min(1,sample)):0;
  return Math.max(0,Math.min(255,Math.round((limited+1)*127.5)));
}
export function pcmVuPercent(packet:Uint8Array):number {
  if(packet.length===0)return 0;
  let sum=0;
  for(const value of packet){
    const normalized=(value-PCM_SILENCE)/128;
    sum+=normalized*normalized;
  }
  const rms=Math.sqrt(sum/packet.length);
  // A sensitive measuring scale to also show A0 chatter.
  return Math.max(0,Math.min(100,Math.round(rms*250)));
}

// Microphone capture typically runs at 44.1 or 48 kHz even when output is 8k.
// Streaming linear interpolation maintains fractional phase across callbacks.
// Only whole 256-byte frames are emitted; network never sees partial frames.
export class Pcm8kPacketizer {
  private nextInputPosition=0;
  private inputIndex=0;
  private previousSample=0;
  private output=new Uint8Array(PCM_BLOCK);
  private writeIndex=0;
  private readonly step:number;
  constructor(inputSampleRate:number) {
    if(!Number.isFinite(inputSampleRate)||inputSampleRate<PCM_RATE)
      throw new Error("The sampling rate of the microphone must be at least 8 kHz.");
    this.step=inputSampleRate/PCM_RATE;
  }
  feed(samples:Float32Array):Uint8Array[] {
    const packets:Uint8Array[]=[];
    for(let i=0;i<samples.length;i++){
      const current=Number.isFinite(samples[i])?samples[i]:0;
      if(this.inputIndex===0)this.previousSample=current;
      // Output sample may fall between previous and current source sample.
      while(this.nextInputPosition<=this.inputIndex+1e-9){
        const phase=Math.max(0,Math.min(1,this.nextInputPosition-(this.inputIndex-1)));
        const value=this.previousSample+(current-this.previousSample)*phase;
        this.output[this.writeIndex++]=encodePcm8u(value);
        if(this.writeIndex===PCM_BLOCK){
          packets.push(this.output);
          this.output=new Uint8Array(PCM_BLOCK);
          this.writeIndex=0;
        }
        this.nextInputPosition+=this.step;
      }
      this.previousSample=current;
      this.inputIndex++;
    }
    return packets;
  }
}
