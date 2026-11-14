import { clamp, midiHz } from './random.js';
import { bodyResonator } from './timbre.js';
const TAU=2*Math.PI;
// Each profile selects a distinct excitation/resonator/playing range. These are
// procedural approximations, not calibrated reconstructions of real instruments.
export const ACOUSTIC_PROFILES = {
  viola:{names:'viola',role:'harmony',family:'bow',brightness:1.65,vibrato:4.8,body:'violin'},
  piccolo:{names:'piccolo',role:'lead',family:'flute',brightness:2.5,air:.045},
  alto_flute:{names:'alto flute',role:'lead',family:'flute',brightness:3.6,air:.12},
  bass_clarinet:{names:'bass clarinet',role:'lead',family:'reed',brightness:1.7,odd:.1},
  english_horn:{names:'english horn|cor anglais',role:'lead',family:'reed',brightness:1.3,odd:.6},
  contrabassoon:{names:'contrabassoon',role:'bass',family:'reed',brightness:2,odd:.8},
  tuba:{names:'tuba',role:'bass',family:'brass',brightness:2.1,drive:1.5},
  cornet:{names:'cornet',role:'lead',family:'brass',brightness:1.2,drive:2.5},
  flugelhorn:{names:'flugelhorn',role:'lead',family:'brass',brightness:1.8,drive:1.9},
  recorder:{names:'recorder',role:'lead',family:'flute',brightness:4,air:.025},
  ocarina:{names:'ocarina',role:'lead',family:'flute',brightness:6,air:.035},
  panpipes:{names:'panpipes|pan pipes|pan flute',role:'lead',family:'flute',brightness:3.2,air:.2},
  bagpipes:{names:'bagpipes',role:'harmony',family:'reed',brightness:1,odd:.55,drone:true},
  harpsichord:{names:'harpsichord',role:'harmony',family:'string',pluck:.12,decay:1.2,body:'wood',course:1.001},
  celesta:{names:'celesta',role:'harmony',family:'bar',ratios:[1,2.77,5.43,8.94],decay:1.5,body:'metal'},
  dulcimer:{names:'dulcimer|hammered dulcimer',role:'harmony',family:'struck',pluck:.18,decay:2.5,body:'wood',course:1.002},
  autoharp:{names:'autoharp',role:'harmony',family:'string',pluck:.32,decay:1.6,body:'guitar',course:2.002},
  resonator_guitar:{names:'resonator guitar|dobro',role:'harmony',family:'string',pluck:.19,decay:2.3,body:'metal'},
  bouzouki:{names:'bouzouki',role:'arp',family:'string',pluck:.16,decay:1.8,body:'wood',course:1.004},
  oud:{names:'oud',role:'harmony',family:'string',pluck:.28,decay:1.3,body:'guitar',course:1.002},
  kora:{names:'kora',role:'arp',family:'string',pluck:.42,decay:1.7,body:'wood'},
  koto:{names:'koto',role:'arp',family:'string',pluck:.09,decay:2.4,body:'wood'},
  shamisen:{names:'shamisen',role:'lead',family:'string',pluck:.065,decay:.65,body:'wood',buzz:.12},
  guzheng:{names:'guzheng',role:'harmony',family:'string',pluck:.21,decay:3.1,body:'wood',course:1.0008},
  erhu:{names:'erhu',role:'lead',family:'bow',brightness:1.05,vibrato:6.2,body:'violin'},
  sarangi:{names:'sarangi',role:'lead',family:'bow',brightness:1.4,vibrato:5.6,body:'wood',drone:true},
  bansuri:{names:'bansuri',role:'lead',family:'flute',brightness:3.4,air:.08},
  shakuhachi:{names:'shakuhachi',role:'lead',family:'flute',brightness:2.8,air:.27},
  didgeridoo:{names:'didgeridoo|didjeridu',role:'bass',family:'reed',brightness:1.1,odd:.35,formant:true},
  handpan:{names:'handpan|hang(?: style tuned percussion)?',role:'harmony',family:'bar',ratios:[1,2,3,4.12,5.43,6.81],decay:2.7,body:'metal'},
  singing_bowl:{names:'singing bowls?|tibetan bowls?',role:'harmony',family:'bar',ratios:[1,2.71,4.93,8.08,11.7],decay:6,body:'metal'},
  glass_harmonica:{names:'glass harmonica|glass armonica',role:'harmony',family:'bow',brightness:3.8,vibrato:.7,body:'glass'},
  cuica:{names:'cuica|cuíca',role:'arp',family:'friction',ratios:[1,1.59,2.14,2.65,3.6],decay:.4,body:'wood'},
  berimbau:{names:'berimbau',role:'arp',family:'string',pluck:.36,decay:1.2,body:'guitar',buzz:.06},
  talking_drum:{names:'talking drum',role:'arp',family:'membrane',ratios:[1,1.59,2.13,2.65,3.15,3.6],decay:.35,body:'wood'},
  guiro:{names:'guiro|güiro',role:'arp',family:'scrape',rate:72,decay:.18,body:'wood'},
  cabasa:{names:'cabasa',role:'arp',family:'scrape',rate:155,decay:.12,body:'metal'},
  modal_cymbal:{names:'modal cymbal',role:'arp',family:'bar',ratios:[1,1.31,1.87,2.13,2.71,3.19,3.71,4.13,4.89,5.27,6.11,7.17,8.31,9.13,10.47,12.19],decay:2.3,body:'metal'},
  modal_plate:{names:'modal plate',role:'harmony',family:'bar',ratios:[1,1.62,2.6,3.58,4.27,5.91,6.3,7.82,9.4,11.2],decay:3.2,body:'metal'},
};
export function stringModes(e,sr,rng,defaults={}) {
  const f=(e.frequency??midiHz(e.note??60))*2**((e.pitch??0)/12),position=e.pluckPosition??defaults.pluck??.22,pickup=e.pickupPosition??.78;
  const struck=defaults.family==='struck'||e.profile==='acoustic_piano',bowed=defaults.family==='bow';
  const width=e.hammerWidth??.08,hard=e.hardness??.5,stiff=e.stiffness??(struck?.00012:0),decay=defaults.decay??(bowed?3:1.8),course=defaults.course;
  const modes=[];
  for(let n=1;n<=Math.min(64,Math.floor(sr*.43/f));n++) {
    const frequency=n*f*Math.sqrt((1+stiff*n*n)/(1+stiff));if(frequency>=sr*.43)continue;
    const coefficient=Math.sin(Math.PI*n*position)*(struck ? Math.sin(Math.PI*n*width/2)/(Math.PI*n*width/2)/n**(1.5-hard*.7) : 1/n**2/(position*(1-position)));
    modes.push({frequency,a:coefficient*Math.sin(Math.PI*n*pickup),phase:0,phase2:rng()*TAU,decay:decay/(1+n*(struck?.12:.08))});
  }
  const norm=Math.max(1,modes.reduce((s,m)=>s+Math.abs(m.a),0)),body=bodyResonator(sr,{body:e.body??defaults.body??'guitar',bodySize:e.bodySize??1,bodyMix:e.bodyMix??.25,sympathetic:e.sympathetic??0});
  return t=> {
    let sum=0;
    for(const m of modes){const vibrato=bowed?1+.003*Math.sin(TAU*(defaults.vibrato??5)*t):1;m.phase+=TAU*m.frequency*vibrato/sr;m.phase2+=TAU*m.frequency*(course??1)/sr;
      const env=bowed?Math.min(1,t/.08)*(e.pressure??.6):Math.exp(-t/m.decay);
      const bow=bowed?Math.tanh(Math.sin(m.phase)*(2+5*(e.pressure??.6))):Math.sin(m.phase);
      sum+=m.a*(course?.5*(bow+Math.sin(m.phase2)):bow)*env;
    }
    const buzz=defaults.buzz?defaults.buzz*Math.tanh(sum*4)*Math.exp(-t/.06):0;
    return body(.6*sum/norm+buzz);
  };
}
export function acousticVoice(e,sr,rng) {
  const spec=ACOUSTIC_PROFILES[e.profile];if(!spec)return null;
  const f=(e.frequency??midiHz(e.note??60))*2**((e.pitch??0)/12),noise=()=>rng()*2-1;
  if(['string','struck','bow'].includes(spec.family))return stringModes(e,sr,rng,spec);
  const body=bodyResonator(sr,{body:e.body??spec.body??'wood',bodyMix:e.bodyMix??.15,bodySize:e.bodySize??1});
  if(['flute','reed','brass'].includes(spec.family)) {
    const harmonics=Array.from({length:Math.max(1,Math.min(40,Math.floor(sr*.43/f)))},(_,i)=>i+1);let phase=0,air=0;
    return t=> {
      const pressure=e.pressure??.6;phase+=f*(1+.002*Math.sin(TAU*(4.7+spec.brightness*.2)*t))/sr;air+=.25*(noise()-air);
      let sum=harmonics.reduce((s,h)=> {const form=spec.formant?Math.exp(-(((h*f-(500+250*Math.sin(t*4)))/200)**2))+.15:1;return s+Math.sin(TAU*phase*h)/h**spec.brightness*(h%2?1:spec.odd??1)*form;},0);
      if(spec.family==='brass')sum=Math.tanh(sum*(spec.drive??2)*pressure);
      if(spec.drone)sum+=.15*Math.sin(TAU*f*.5*t)+.08*Math.sin(TAU*f*.75*t);
      return .22*body(sum*Math.min(1,t/(spec.family==='brass'?.07:.04))+.25*(spec.air??.025)*air)*(.4+pressure);
    };
  }
  const ratios=spec.ratios??[1,1.47,2.13,3.6,5.2];
  const modes=ratios.map((r,i)=>({f:f*r,a:1/(i+1)**1.25,decay:spec.decay/(1+i*.22)})).filter(m=>m.f<sr*.43);
  let scrape=0;
  return t=> {
    let sum=0;const bend=spec.family==='membrane'?1+.35*Math.exp(-t*8):spec.family==='friction'?1+.22*Math.sin(t*18):1;
    for(const m of modes)sum+=m.a*Math.sin(TAU*m.f*t*bend)*Math.exp(-t/m.decay);
    if(spec.family==='scrape'){const hit=Math.max(0,Math.cos(TAU*spec.rate*t))**16;scrape=.92*scrape+.08*noise();sum=(noise()-scrape)*hit*Math.exp(-t/spec.decay);}
    if(spec.family==='friction')sum*=Math.tanh(noise()*3);
    return .35*body(sum);
  };
}
// A bank shared across the whole part is excited by every played note. Its
// feedback couples the modal states; energy/damping remain bounded below unity.
export function sympatheticBody(left,right,sr,events,settings={}) {
  const amount=settings.sympathetic??0;if(!amount)return;
  const frequencies=[...new Set(events.map(e=>e.frequency??midiHz(e.note??60)))].filter(f=>f>20&&f<sr*.4).slice(0,32);
  const modes=frequencies.map(f=>{const r=Math.exp(-1/(sr*1.6));return{a:2*r*Math.cos(TAU*f/sr),r2:r*r,g:2*(1-r),y1:0,y2:0};});
  let feedback=0;const bl=bodyResonator(sr,settings),br=bodyResonator(sr,settings);
  for(let i=0;i<left.length;i++) {
    const input=(left[i]+right[i])*.5;let sum=0;
    for(const m of modes){const y=m.g*(input+.05*feedback)+m.a*m.y1-m.r2*m.y2;m.y2=m.y1;m.y1=y;sum+=y;}
    feedback=clamp(sum/Math.max(1,modes.length),-2,2);left[i]+=amount*.5*bl(feedback);right[i]+=amount*.5*br(feedback);
  }
}
