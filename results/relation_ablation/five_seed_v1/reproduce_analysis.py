"""Reproduce descriptive statistics, exploratory uncertainty, and figures.
Dependencies: numpy, scipy, matplotlib. Input: analysis_input.json alongside script.
"""
import json,math,itertools,statistics
from pathlib import Path
import numpy as np
from scipy.stats import t
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
OUT=Path(__file__).resolve().parent
raw=json.loads((OUT/'analysis_input.json').read_text(encoding='utf-8'))
by={r['run']:r for r in raw};assert len(by)==len(raw)==40
names={'A1_target':'Target','A2_enzyme':'Enzyme','A3_transporter':'Transporter','A4_carrier':'Carrier','A5_indication':'Indication','A6_contraindication':'Contraindication','A7_off_label':'Off-label use'}
seeds=[42,43,44,45,46];base=np.array([by[f'G0_seed{s}']['MRR'] for s in seeds])
rows=[]
for graph,label in names.items():
 vals=np.array([by[f'{graph}_seed{s}']['MRR'] for s in seeds]);d=vals-base
 delta=float(d.mean());sd=float(d.std(ddof=1));margin=float(t.ppf(.975,4)*sd/math.sqrt(5))
 null=[abs(np.mean(d*np.array(sign))) for sign in itertools.product([-1,1],repeat=5)]
 p=sum(v>=abs(delta)-1e-15 for v in null)/32
 rows.append(dict(graph=graph,relation=label,n=5,mean_MRR=float(vals.mean()),sd_MRR=float(vals.std(ddof=1)),
                  mean_delta=delta,sd_delta=sd,ci95_low=delta-margin,ci95_high=delta+margin,
                  wins=int((d>0).sum()),losses=int((d<0).sum()),sign_flip_p=p,
                  per_seed=[dict(seed=s,MRR=float(v),G0_MRR=float(b),delta=float(x)) for s,v,b,x in zip(seeds,vals,base,d)]))
ordered=sorted(rows,key=lambda r:r['sign_flip_p']);prev=0
for i,row in enumerate(ordered):
 prev=max(prev,min(1.,(7-i)*row['sign_flip_p']));row['sign_flip_p_holm']=prev
rows.sort(key=lambda r:-r['mean_MRR'])
summary={'baseline':{'n':5,'mean_MRR':float(base.mean()),'sd_MRR':float(base.std(ddof=1))},'relations':rows,
         'method':'Paired seed deltas; sample SD; two-sided pointwise t intervals with df4. Exploratory exact sign flips enumerate32patterns; Holm adjustment across7relations. Intervals assume approximately normal independent seed effects; sign flips assume symmetry/exchangeability under null. No test-pair independence assumed.',
         'limits':'Five seeds on one fixed split. Intervals are not simultaneous and do not quantify split, dataset or clinical uncertainty. Mixed numerical implementation lineage is retained; same mathematical operator validated, not bitwise identical training. Analysis choices documented after results, not preregistered.'}
(OUT/'statistics.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
header='| Relation | Mean MRR ± SD | Mean paired ΔMRR | 95% paired t interval | Wins |\n|---|---:|---:|---:|---:|\n'
table=header+'\n'.join(f"| {r['relation']} | {r['mean_MRR']:.6f} ± {r['sd_MRR']:.6f} | {r['mean_delta']:+.6f} | [{r['ci95_low']:+.6f}, {r['ci95_high']:+.6f}] | {r['wins']}/5 |" for r in rows)
(OUT/'results_table.md').write_text(table+'\n',encoding='utf-8')
latex=['% Requires booktabs; uncertainty is across seeds on one fixed split.',r'\begin{tabular}{lrrrr}',r'\toprule',r'Relation & MRR (mean $\pm$ SD) & Mean $\Delta$MRR & 95\% interval & Wins \\',r'\midrule']
for r in rows:
 latex.append(f"{r['relation']} & ${r['mean_MRR']:.6f} \\pm {r['sd_MRR']:.6f}$ & ${r['mean_delta']:+.6f}$ & $[{r['ci95_low']:+.6f}, {r['ci95_high']:+.6f}]$ & {r['wins']}/5 \\\\")
latex += [r'\bottomrule',r'\end{tabular}']
(OUT/'results_table.tex').write_text('\n'.join(latex)+'\n',encoding='utf-8')
plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(figsize=(9,5.4))
y=np.arange(7);means=np.array([r['mean_delta'] for r in rows]);err=np.array([r['ci95_high']-r['mean_delta'] for r in rows])
ax.axvline(0,color='#777777',lw=1,ls='--');ax.errorbar(means,y,xerr=err,fmt='o',color='#146b8c',capsize=4,lw=1.8)
ax.set_yticks(y,[r['relation'] for r in rows]);ax.invert_yaxis();ax.set_xlabel('Mean paired ΔMRR versus G0')
ax.set_title('Relation-level ablation: five paired seeds',loc='left',weight='bold')
fig.text(.02,.015,'Points: mean of seeds 42–46. Bars: pointwise 95% t intervals (df = 4); one fixed split.',fontsize=9)
fig.tight_layout(rect=(0,.045,1,1))
for ext in ('png','pdf'):fig.savefig(OUT/f'paired_delta_intervals.{ext}',dpi=200)
plt.close(fig)
fig,ax=plt.subplots(figsize=(8,5.4));matrix=np.array([[x['delta'] for x in r['per_seed']] for r in rows]);lim=abs(matrix).max()
im=ax.imshow(matrix,cmap='RdBu',vmin=-lim,vmax=lim,aspect='auto')
ax.set_xticks(range(5),seeds);ax.set_yticks(range(7),[r['relation'] for r in rows]);ax.set_xlabel('Training seed')
for i in range(7):
 for j in range(5):ax.text(j,i,f'{matrix[i,j]:+.4f}',ha='center',va='center',color='white' if abs(matrix[i,j])>lim*.65 else '#202020')
ax.set_title('Paired ΔMRR for every seed',loc='left',weight='bold');fig.colorbar(im,ax=ax,label='MRR difference versus same-seed G0')
fig.tight_layout()
for ext in ('png','pdf'):fig.savefig(OUT/f'per_seed_deltas.{ext}',dpi=200)
plt.close(fig)
print(table)
print('Exploratory sign-flip p / Holm:',[(r['relation'],r['sign_flip_p'],r['sign_flip_p_holm']) for r in rows])
