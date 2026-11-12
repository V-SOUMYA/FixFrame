import json
d=json.load(open('rec/ts.json')); f=d['frames']; s=d['marks']['start']; e=d['marks']['end']
st=max(i for i,t in enumerate(f) if t<=s); L=[]
for i in range(st,len(f)):
    t0=max(f[i],s); t1=min(f[i+1] if i+1<len(f) else e, e)
    if t1>t0: L.append(f"file 'rec/{i:05d}.jpg'\nduration {t1-t0:.4f}")
L.append(f"file 'rec/{len(f)-1:05d}.jpg'"); open('rec.txt','w').write("\n".join(L))
