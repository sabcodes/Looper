"""Optional offline development diagnostics. Never imported by the Node generator."""
from study_references import ROOT, decode, digest
from analyze_audio import tempo_relation
import argparse
import importlib.util
import json
import re
from pathlib import Path
import time


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--semantic', action='store_true')
    p.add_argument('--force', action='store_true')
    p.add_argument('--model-dir', type=Path, default=ROOT/'models/clap')
    p.add_argument('--stem-project', type=Path, required=True)
    args = p.parse_args()
    began = time.perf_counter()
    manifest = json.loads(args.manifest.read_text())
    if manifest['status'] != 'complete':
        raise ValueError('Render the entire set before analyzing.')
    if not re.fullmatch(r'[a-z0-9-]+', manifest['batch']):
        raise ValueError('Invalid batch name.')
    output = args.manifest.resolve().parent
    if not output.is_relative_to((ROOT/'generated_beats').resolve()):
        raise ValueError('Manifest and reports must stay inside generated_beats/.')
    target = output/(manifest['batch']+'.diagnostics.json')
    review = output/(manifest['batch']+'.review.md')
    if not args.force and (target.exists() or review.exists()):
        raise ValueError('Diagnostics already exist; choose a fresh rendered batch.')
    import numpy as np
    import librosa
    from scipy.signal import welch
    source = args.stem_project/'cli.py'
    spec = importlib.util.spec_from_file_location('existing_stem_analysis', source)
    stem = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stem)
    definitions_path = ROOT/'data/analysis-descriptions.json'
    definitions = json.loads(definitions_path.read_text())
    genres = list(definitions['genres'])
    labels = genres + list(definitions['moods'])
    texts = list(definitions['genres'].values()) + list(definitions['moods'].values())
    for c in definitions['sound_contrasts']:
        labels += [c['id']+'_a', c['id']+'_b']
        texts += [c['a'], c['b']]
    shared_count = len(labels)
    texts += [r['prompt'] for r in manifest['cases']]
    audio_vectors = []
    model_metadata = None
    if args.semantic:
        import torch
        from transformers import ClapModel, ClapProcessor
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        torch.manual_seed(0)
        np.random.seed(0)
        model_metadata = json.loads((args.model_dir/'.ready').read_text())
        if model_metadata.get('repository') != 'laion/clap-htsat-unfused' or model_metadata.get('dimension') != 512:
            raise ValueError('Unexpected cached model; downloads are disabled.')
        processor = ClapProcessor.from_pretrained(args.model_dir, local_files_only=True)
        model = ClapModel.from_pretrained(args.model_dir, local_files_only=True, use_safetensors=False, weights_only=True).eval()
        with torch.inference_mode():
            vectors = []
            for i in range(0, len(texts), 4):
                v = model.get_text_features(**processor(text=texts[i:i+4], padding=True, truncation=True, return_tensors='pt'))
                vectors.append(v/v.norm(dim=-1, keepdim=True))
            text_vectors = torch.cat(vectors)
    rows = []
    for i, item in enumerate(manifest['cases']):
        print('Analyzing '+item['id']+': '+item['prompt'], flush=True)
        path = output/item['audio']
        if path.parent != output or digest(path) != item['audioChecks']['audioSha256']:
            raise ValueError('Audio path/identity mismatch.')
        y = decode(path, 0, 16, 22050)
        freq, power = welch(y, fs=22050, nperseg=8192)
        bands = {name: float(power[(freq >= lo) & (freq < hi)].sum()/max(1e-12, power.sum()))
                 for name, lo, hi in [('sub',20,80),('low',80,250),('body',250,1200),('mid',1200,4000),('high',4000,10000)]}
        estimate = stem.analyze(path)
        row = {'id': item['id'], 'source_sha256': digest(path), 'prompt': item['prompt'],
               'tempo_key_estimates': estimate, 'tempo_comparison': tempo_relation(estimate['bpm'], item['interpretation']['bpm']),
               'band_power_fractions': bands, 'spectral_centroid_hz': float(librosa.feature.spectral_centroid(y=y, sr=22050).mean()),
               'rms_dbfs': float(10*np.log10(max(1e-12, np.mean(y*y))))}
        if args.semantic:
            # Fixed 10 s centered excerpt; resample/normalize only in memory.
            audio = decode(path, 3, 10, 48000)
            rms = float(np.sqrt(np.mean(audio*audio)))
            gain = min(.1/max(1e-9,rms), .95/max(1e-9,float(np.max(np.abs(audio)))))
            audio *= gain
            with torch.inference_mode():
                av = model.get_audio_features(**processor(audio=[audio], sampling_rate=48000, padding='repeatpad', truncation='rand_trunc', return_tensors='pt'))[0]
                av = av/av.norm()
                cosines = (text_vectors@av).cpu().tolist()
                audio_vectors.append(av.cpu().numpy())
            scores = dict(zip(labels, cosines[:shared_count]))
            ranking = sorted([dict(intent=g, cosine=scores[g]) for g in genres], key=lambda r:-r['cosine'])
            expected = item['expect'].get('intent')
            row['semantic'] = {'genre_ranking': ranking,
                'explicit_expected_style_rank': next((n+1 for n,r in enumerate(ranking) if r['intent']==expected), None),
                'prompt_cosine': cosines[shared_count+i], 'rms_normalization_gain': gain,
                'mood_cosines': {k:scores[k] for k in definitions['moods']},
                'sound_contrasts': [{**c,'a_cosine':scores[c['id']+'_a'],'b_cosine':scores[c['id']+'_b'],
                    'a_minus_b':scores[c['id']+'_a']-scores[c['id']+'_b']} for c in definitions['sound_contrasts']]}
        rows.append(row)
    report = {'batch':manifest['batch'],'manifest_sha256':digest(args.manifest),'analysis_seconds':time.perf_counter()-began,
        'reused_tool':{'source':str(source),'sha256':digest(source),'function':'analyze'},
        'versions':{'numpy':np.__version__,'librosa':librosa.__version__},
        'source_files':{p:digest(ROOT/p) for p in ['scripts/analyze-listening-set.py','scripts/study_references.py','scripts/analyze_audio.py','data/analysis-descriptions.json']},
        'description_version':definitions['version'],'descriptions':definitions,'model':model_metadata,
        'caveats':['Development diagnostics, not a held-out benchmark or a musical-quality score.',
                   'Full-mix similarity conflates drums, timbre and harmony; it does not identify instruments.',
                   'Vague prompts have no single correct genre. Only explicit genre requests receive diagnostic ranks.',
                   'Tempo may be half/double the pulse. Major/minor key templates cannot validate all modal scales.',
                   'Only the saved excerpts are analyzed; full arrangement listening remains outstanding.'], 'rows':rows}
    pairs = []
    if args.semantic:
        matrix = np.stack(audio_vectors)@np.stack(audio_vectors).T
        report['audio_similarity'] = {'ids':[r['id'] for r in rows],'cosines':matrix.tolist()}
        for i in range(len(rows)):
            for j in range(i+1,len(rows)):
                pairs.append({'a':rows[i]['id'],'b':rows[j]['id'],'cosine':float(matrix[i,j])})
        pairs.sort(key=lambda r:-r['cosine'])
        report['closest_pairs'] = pairs[:20]
    with target.open('w' if args.force else 'x') as f:
        json.dump(report,f,indent=2,allow_nan=False)
        f.write('\n')
    lines = ['# Listening review priorities','',*report['caveats'],'',
             'This set contains '+str(len(rows))+' clips; the following are diagnostic listening flags, not failures or approvals.','']
    if args.semantic:
        lines += ['## Similar-sounding pairs to compare','', 'Cosine similarity can reflect shared drums or tone. Listen before deciding whether two cases are redundant.','']
        for pair in pairs[:10]:
            lines.append('- Cases '+pair['a']+' / '+pair['b']+': '+str(round(pair['cosine'],3)))
        lines += ['', '## Explicit genre requests to review first','']
        ranked = sorted([r for r in rows if r['semantic']['explicit_expected_style_rank']],key=lambda r:-r['semantic']['explicit_expected_style_rank'])
        for row in ranked[:10]:
            lines.append('- '+row['id']+': requested style rank '+str(row['semantic']['explicit_expected_style_rank'])+'/'+str(len(genres))+' — '+row['prompt'])
    lines += ['', '[Listen to every case](<'+str(output/(manifest['batch']+'.listening.md') if (output/(manifest['batch']+'.listening.md')).exists() else output/'listening.md')+'>)', '', '[Complete diagnostics](<'+str(target)+'>)', '']
    review.write_text('\n'.join(lines))
    print('Diagnostics: '+str(target),flush=True)


if __name__ == '__main__':
    main()
