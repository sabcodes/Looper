"""Bounded, local reference analysis. Generation never imports this module.

Read originals in place. HPSS and pYIN yield mixed-audio proxies, not isolated
instrument stems or a validated musical transcription. Fixed CLAP contrasts
remain secondary to the user's listening examples.
"""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'generated_beats/.analysis-cache'
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMBA_NUM_THREADS'):
    os.environ[key] = '2'
os.environ.update(PYTHONDONTWRITEBYTECODE='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                  HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false',
                  NUMBA_CACHE_DIR=str(CACHE/'numba'), XDG_CACHE_HOME=str(CACHE), HF_HOME=str(CACHE/'huggingface'), TORCH_HOME=str(CACHE/'torch'))
import argparse
import gc
import hashlib
import json
import math
import re
import subprocess
import time


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def probe(path):
    result = subprocess.run(['ffprobe', '-protocol_whitelist', 'file,pipe','-v','error','-show_entries','format=duration,size:stream=sample_rate,channels,codec_name', '-of','json',str(path)], capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def decode(path, start, seconds, rate):
    import numpy as np
    if not 0 <= start or not 0 < seconds <= 180:
        raise ValueError('Invalid bounded decode.')
    result = subprocess.run(['ffmpeg', '-nostdin', '-protocol_whitelist', 'file,pipe','-v','error','-threads','1','-filter_threads','1','-ss',str(start),'-i',str(path),'-t',str(seconds),'-ac','1','-ar',str(rate),'-f','f32le','pipe:1'], capture_output=True, timeout=90, check=True)
    y = np.frombuffer(result.stdout, dtype='<f4').copy()
    if not y.size or y.size > (seconds+.1)*rate or not np.isfinite(y).all():
        raise ValueError('Invalid decoded audio.')
    return y


def frame_rms(y, rate, hop=128, width=512):
    import numpy as np
    values = np.pad(y.astype('float64')**2, (width//2,width//2))
    sums = np.concatenate(([0.], np.cumsum(values)))
    starts = np.arange(0, len(y), hop)
    return np.sqrt(np.maximum(0, (sums[starts+width]-sums[starts])/width))


def filtered(y, rate, lo, hi):
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(4, [lo,hi], btype='bandpass', fs=rate, output='sos'), y)


def select_windows(y, rate, seconds=16, stride=4):
    import numpy as np
    low = filtered(y, rate, 30, 250)
    hop = 128
    env = frame_rms(low, rate, hop)
    threshold = max(1e-9, float(np.quantile(env,.9))*.22)
    duration = len(y)/rate
    candidates = []
    for start in np.arange(0, max(.001,duration-seconds+.001), stride):
        a, b = round(start*rate), round((start+seconds)*rate)
        segment = y[a:b]; l = low[a:b]
        e = env[round(start*rate/hop):round((start+seconds)*rate/hop)]
        if not segment.size or not e.size:
            continue
        energy = float(np.mean(l*l))
        active = float(np.mean(e>threshold))
        floor = float(np.quantile(e,.3)/max(1e-9,np.quantile(e,.9)))
        candidates.append({'start':float(start),'duration':min(seconds,duration-start),'low_band_rms_dbfs':10*math.log10(max(1e-12,energy)),
                           'low_active_fraction':active,'envelope_floor_ratio':floor})
    if not candidates:
        raise ValueError('Track too short for a representative window.')
    lo = min(c['low_band_rms_dbfs'] for c in candidates); hi = max(c['low_band_rms_dbfs'] for c in candidates)
    for c in candidates:
        level = (c['low_band_rms_dbfs']-lo)/max(1e-6,hi-lo)
        c['selection_score'] = .55*level + .3*c['low_active_fraction'] + .15*c['envelope_floor_ratio']
    ranked = sorted(candidates, key=lambda c: (-c['selection_score'],c['start']))
    best = ranked[0]
    alternatives = [c for c in ranked[1:] if abs(c['start']-best['start'])>=seconds][:2]
    return best, alternatives, ranked


def band_onsets(magnitude, frequencies, lo, hi, hop, rate):
    import numpy as np
    from scipy.signal import find_peaks
    # Positive spectral flux in a frequency region, robustly scaled per excerpt.
    selected = magnitude[(frequencies>=lo)&(frequencies<hi)]
    compressed = np.log1p(selected*10)
    flux = np.maximum(0,np.diff(compressed,axis=1)).mean(axis=0)
    flux = np.pad(flux,(1,0))
    if not flux.size or np.max(flux)<1e-9:
        return [], flux
    peaks,_ = find_peaks(flux, distance=max(1,round(.09*rate/hop)), prominence=max(1e-8,float(np.quantile(flux,.9))*.3))
    peaks = peaks[flux[peaks] > np.quantile(flux,.75)]
    return (peaks*hop/rate).tolist(),flux


def onset_summary(onsets, beats):
    import numpy as np
    if len(beats)<3 or not onsets:
        return {'count':len(onsets),'offbeat_fraction':None,'phases':[]}
    phases=[]
    for onset in onsets:
        i = int(np.searchsorted(beats,onset)-1)
        if i<0 or i>=len(beats)-1:
            continue
        phases.append(float((onset-beats[i])/(beats[i+1]-beats[i])))
    off = sum(.18<p<.82 for p in phases)/len(phases) if phases else None
    return {'count':len(onsets),'offbeat_fraction':off,'phases':phases,
            'caveat':'Energy-flux peaks, not note onsets. Baseline calibration shows modulation causes extra peaks; do not interpret this fraction as note syncopation or swing.'}


def describe_excerpt(path, start, seconds, raw_bpm):
    import numpy as np
    import librosa
    from scipy.signal import welch
    rate,hop=11025,128
    y=decode(path,start,seconds,rate)
    spectrum=librosa.stft(y,n_fft=2048,hop_length=hop)
    harmonic,percussive=librosa.decompose.hpss(spectrum,kernel_size=31,margin=2)
    frequencies=librosa.fft_frequencies(sr=rate,n_fft=2048)
    harmonic_low=harmonic.copy(); harmonic_low[(frequencies<25)|(frequencies>300)]=0
    hlow=librosa.istft(harmonic_low,hop_length=hop,length=len(y))
    envelope=frame_rms(hlow,rate,hop)
    active=envelope>max(1e-8,float(np.quantile(envelope,.95))*.18)
    hpow=np.abs(harmonic)**2; ppow=np.abs(percussive)**2
    lowmask=(frequencies>=25)&(frequencies<300)
    harmonic_share=float(np.sum(hpow[lowmask])/max(1e-12,np.sum(hpow[lowmask])+np.sum(ppow[lowmask])))
    tonal_onsets,_=band_onsets(np.abs(harmonic),frequencies,30,350,hop,rate)
    percussive_onsets,_=band_onsets(np.abs(percussive),frequencies,30,250,hop,rate)
    onset=librosa.onset.onset_strength(S=librosa.amplitude_to_db(np.abs(percussive)+1e-8),sr=rate,hop_length=hop)
    _,beat_frames=librosa.beat.beat_track(onset_envelope=onset,sr=rate,hop_length=hop,bpm=raw_bpm,trim=False)
    beats=librosa.frames_to_time(beat_frames,sr=rate,hop_length=hop).tolist()
    lags=[]
    for t in tonal_onsets:
        if percussive_onsets:
            d=t-min(percussive_onsets,key=lambda p:abs(t-p))
            if abs(d)<=.15:
                lags.append(d)
    f0,voiced,prob=librosa.pyin(hlow,sr=rate,frame_length=2048,hop_length=hop,fmin=30,fmax=200,n_thresholds=50,resolution=.2)
    reliable=np.isfinite(f0)&voiced&(prob>.15)&active[:len(f0)]
    midi=np.full(len(f0),-100,dtype=int)
    midi[reliable]=np.rint(librosa.hz_to_midi(f0[reliable])).astype(int)
    segments=[]; i=0
    while i<len(midi):
        j=i+1
        while j<len(midi) and midi[j]==midi[i]:j+=1
        if midi[i]>0 and (j-i)*hop/rate>=.1:
            segments.append({'start_seconds':i*hop/rate,'duration_seconds':(j-i)*hop/rate,'midi_proxy':int(midi[i])})
        i=j
    freq,power=welch(y,fs=rate,nperseg=8192)
    bands={name:float(np.sum(power[(freq>=a)&(freq<b)])/max(1e-12,np.sum(power))) for name,a,b in [('sub',20,80),('low',80,250),('low_mid',250,1200),('upper',1200,5000)]}
    # Long silences below a relative harmonic-low threshold, not note gates.
    inactive_runs=[]; i=0
    while i<len(active):
        if active[i]:i+=1;continue
        j=i+1
        while j<len(active) and not active[j]:j+=1
        inactive_runs.append((j-i)*hop/rate);i=j
    return {'start_seconds':start,'duration_seconds':len(y)/rate,'estimated_bpm_used_for_grid':raw_bpm,
      'band_power_fractions':bands,'spectral_centroid_hz':float(librosa.feature.spectral_centroid(y=y,sr=rate).mean()),
      'harmonic_low_band_share':harmonic_share,'harmonic_low_active_fraction':float(np.mean(active)),
      'harmonic_low_floor_ratio':float(np.quantile(envelope,.3)/max(1e-9,np.quantile(envelope,.9))),
      'longest_harmonic_low_gap_seconds':max(inactive_runs,default=0),
      'tonal_low_flux_peaks':onset_summary(tonal_onsets,beats),'percussive_low_flux_peaks':onset_summary(percussive_onsets,beats),
      'tonal_flux_peak_times_seconds':tonal_onsets,'percussive_flux_peak_times_seconds':percussive_onsets,
      'nearby_flux_peak_lags':{'matched_within_150ms':len(lags),'median_seconds':float(np.median(lags)) if lags else None,
        'within_30ms_fraction':float(np.mean(np.abs(lags)<=.03)) if lags else None},
      'pitch_proxy':{'method':'pYIN on HPSS harmonic 25–300 Hz band, threshold .15; mixture/low-frequency octave errors remain possible.',
        'reliable_frame_fraction':float(np.mean(reliable)),'median_f0_hz':float(np.nanmedian(f0[reliable])) if np.any(reliable) else None,
        'stable_segment_median_seconds':float(np.median([s['duration_seconds'] for s in segments])) if segments else None,
        'segments':segments},
      'display_curve':{'hop_seconds':hop/rate,'harmonic_low_envelope':(envelope/max(1e-9,float(np.quantile(envelope,.99)))).tolist()},
      'caveat':'HPSS regions are tonal/percussive proxies from a full mix. They do not isolate bass, kick, vocals or a known source instrument.'}


def loudness(path,start,seconds):
    result=subprocess.run(['ffmpeg', '-nostdin', '-protocol_whitelist', 'file,pipe','-hide_banner','-nostats','-ss',str(start),'-i',str(path),'-t',str(seconds),'-af','ebur128=framelog=verbose:peak=true','-f','null','-'],capture_output=True,text=True,timeout=120,check=True)
    out={}
    for key,pattern in [('lufs',r'I:\s+(-?[\d.]+) LUFS'),('true_peak_dbfs',r'Peak:\s+(-?[\d.]+) dBFS')]:
        matches=re.findall(pattern,result.stderr)
        if not matches:raise ValueError('Missing loudness summary')
        out[key]=float(matches[-1])
    return out


def semantics(rows,model_dir):
    import numpy as np
    import torch
    from transformers import ClapModel,ClapProcessor
    torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(0);np.random.seed(0)
    marker=model_dir/'.ready'
    metadata=json.loads(marker.read_text())
    if metadata.get('repository')!='laion/clap-htsat-unfused':raise ValueError('Unexpected cached model')
    definitions=json.loads((ROOT/'data/reference-texture-descriptions.json').read_text())
    labels=list(definitions['descriptions']);texts=list(definitions['descriptions'].values())
    processor=ClapProcessor.from_pretrained(model_dir,local_files_only=True)
    model=ClapModel.from_pretrained(model_dir,local_files_only=True,use_safetensors=False,weights_only=True).eval()
    with torch.inference_mode():
        text_vectors=[]
        for i in range(0,len(texts),4):
            v=model.get_text_features(**processor(text=texts[i:i+4],padding=True,truncation=True,return_tensors='pt'))
            text_vectors.append(v/v.norm(dim=-1,keepdim=True))
        tv=torch.cat(text_vectors)
        avs=[]
        for row in rows:
            print('Comparing texture: '+row['label'],flush=True)
            offset=row['selected']['start_seconds']+max(0,(row['selected']['duration_seconds']-10)/2)
            y=decode(row['source'],offset,10,48000)
            rms=float(np.sqrt(np.mean(y*y)));peak=float(np.max(np.abs(y)))
            gain=min(.1/max(1e-9,rms),.95/max(1e-9,peak));y*=gain
            av=model.get_audio_features(**processor(audio=[y],sampling_rate=48000,padding='repeatpad',truncation='rand_trunc',return_tensors='pt'))[0]
            av=av/av.norm();avs.append(av.cpu().numpy())
            scores=(tv@av).cpu().tolist()
            row['semantic']={'model':metadata,'window_start_seconds':offset,'window_seconds':len(y)/48000,
              'rms_normalization_gain':gain,'rms_after_normalization':rms*gain,
              'ranking':sorted([{'description':label,'cosine':float(score)} for label,score in zip(labels,scores)],key=lambda r:-r['cosine']),
              'caveat':'Exploratory fixed-description similarity, not source identification, confidence, quality, or proof of a particular instrument.'}
    matrix=np.stack(avs)@np.stack(avs).T
    return {'descriptions':definitions,'descriptions_sha256':digest(ROOT/'data/reference-texture-descriptions.json'),
            'ids':[r['id'] for r in rows],'audio_cosine_matrix':matrix.tolist()}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,required=True);parser.add_argument('--output',required=True);parser.add_argument('--semantic',action='store_true')
    args=parser.parse_args()
    if Path(args.output).name!=args.output or not args.output.endswith('.json'):raise ValueError('Use a JSON filename in generated_beats/')
    destination=ROOT/'generated_beats'/args.output
    if destination.exists():raise ValueError('Report already exists')
    import numpy as np
    import librosa
    import psutil
    started=time.perf_counter();inputs=json.loads(args.manifest.read_text());rows=[]
    for entry in inputs['entries']:
        path=Path(entry['source']);before=path.stat();info=probe(path);duration=float(info['format']['duration'])
        print('Scanning '+entry['label'],flush=True)
        rate=8000;y=decode(path,0,min(180,duration),rate)
        estimated,beats=librosa.beat.beat_track(y=y,sr=rate,hop_length=128,trim=False)
        estimated=float(np.atleast_1d(estimated)[0])
        if entry.get('start') is not None:
            selected={'start':entry['start'],'duration':min(16,duration-entry['start'])};alternatives=[];candidates=[]
        else:selected,alternatives,candidates=select_windows(y,rate)
        actual=entry.get('knownBpm') or estimated
        if actual<=0:raise ValueError('No beat estimate found')
        print('Analyzing '+entry['id']+' at '+str(selected['start'])+' s',flush=True)
        features=describe_excerpt(path,selected['start'],selected['duration'],actual)
        row={**entry,'source_sha256':digest(path),'source_metadata':info,'scanned_seconds':len(y)/rate,
             'selection':{'method':'Provided baseline offset' if entry.get('start') is not None else 'Rank 16 s windows on 4 s grid by low-band level, activity and envelope floor; automatic, not user-confirmed.',
                          'primary':selected,'alternatives':alternatives,'candidate_count':len(candidates)},
             'tempo_estimate':estimated,'tempo_candidates':[estimated/2,estimated,estimated*2],
             'selected':features,'source_excerpt_loudness':loudness(path,selected['start'],selected['duration'])}
        if entry.get('knownScore'):
            score=json.loads(Path(entry['knownScore']).read_text())
            offset=entry.get('scoreAudioOffsetSeconds',0)
            expected=[{'start':e['time']-offset,'end':e['time']+e['duration']-offset,'note':e['note']} for e in score['bass'] if e['time']+e['duration']>offset and e['time']<offset+features['duration_seconds']]
            comparisons=[]
            for segment in features['pitch_proxy']['segments']:
                middle=segment['start_seconds']+segment['duration_seconds']/2
                truth=next((e for e in expected if e['start']<=middle<e['end']),None)
                if truth:comparisons.append({'seconds':segment['duration_seconds'],'semitone_error':segment['midi_proxy']-truth['note']})
            weight=sum(c['seconds'] for c in comparisons)
            row['baseline_calibration']={'ground_truth_source':entry['knownScore'],'score_audio_offset_seconds':offset,
              'known_bass_onsets_in_excerpt':sum(e['start']>=0 for e in expected),'flux_peaks_valid_as_note_events':False,'detected_tonal_low_flux_peaks':len(features['tonal_flux_peak_times_seconds']),
              'pitch_segments_compared_seconds':weight,
              'within_one_semitone_fraction':sum(c['seconds'] for c in comparisons if abs(c['semitone_error'])<=1)/weight if weight else None,
              'within_one_semitone_pitch_class_fraction':sum(c['seconds'] for c in comparisons if abs((c['semitone_error']+6)%12-6)<=1)/weight if weight else None,
              'caveat':'Known generated note events are a calibration control. Audio-envelope attacks need not be note attacks; distorted harmonics can cause octave errors.'}
        after=path.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Original changed during analysis')
        rows.append(row);del y;gc.collect()
    report={'version':2,'inputs':inputs,'input_manifest_sha256':digest(args.manifest),'script_sha256':digest(Path(__file__)),
      'versions':{'librosa':librosa.__version__,'numpy':np.__version__},'methods':{
        'hpss':'https://librosa.org/doc/0.11.0/generated/librosa.decompose.hpss.html',
        'pitch_proxy':'https://librosa.org/doc/0.11.0/generated/librosa.pyin.html',
        'beat_tracker':'https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html'},
      'entries':rows,'rejected_interpretations':['Spectral-flux peaks are not bass-note events or isolated kick hits; the generated baseline produced 66 such peaks for four known bass starts.','Raw full-mix CLAP similarity is not bass-only similarity; vocals and other instruments affect the embeddings.','Stable pYIN segments on a mixture are not an exact note-duration transcription, especially where voiced coverage is low.'],
      'interpretation_boundary':'User supplies the positive musical reference label. Automated selection, band separation, pitch, instrument descriptions and groove statistics remain estimates. No generation model, sample extraction for synthesis, or training occurs.'}
    if args.semantic:report['semantic_comparison']=semantics(rows,ROOT/'models/clap')
    report['elapsed_seconds']=time.perf_counter()-started;report['rss_mb_at_completion']=psutil.Process().memory_info().rss/1024**2
    destination.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print('Saved '+str(destination),flush=True)


if __name__=='__main__':main()
