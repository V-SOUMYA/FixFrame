import numpy as np, wave
SR=44100
D={'intro':13.5,'optA':13.2,'menuB':2.4,'optB':21.0,'menuC':2.4,'optC':6.2,'app':97.666667,'ending':13.0}
order=['intro','optA','menuB','optB','menuC','optC','app','ending']
O={};acc=0
for k in order: O[k]=acc; acc+=D[k]
T=acc; N=int(T*SR)+SR
mus=np.zeros(N); sfx=np.zeros(N)
rng=np.random.default_rng(7)
def tt(n): return np.arange(n)/SR
def add(buf,t,x,g=1.0):
    i=int(t*SR); j=min(N,i+len(x)); buf[i:j]+=x[:j-i]*g
def env(n,a=.005,d=.3):
    t=tt(n); return np.minimum(1,t/a)*np.exp(-t/d)
def note(f,dur,kind='pluck',g=.3):
    n=int(dur*SR); t=tt(n)
    if kind=='pluck': x=(np.sin(2*np.pi*f*t)+.4*np.sin(4*np.pi*f*t)+.15*np.sin(6*np.pi*f*t))*env(n,.003,.16)
    elif kind=='bass': x=(np.sin(2*np.pi*f*t)+.3*np.sin(4*np.pi*f*t))*env(n,.005,.22)
    elif kind=='keys': x=(np.sin(2*np.pi*f*t)+.25*np.sin(4*np.pi*f*t)+.08*np.sin(6*np.pi*f*t))*env(n,.01,.7)
    elif kind=='pad':
        x=sum(np.sin(2*np.pi*f*(1+d)*t) for d in (-.004,0,.004))/3*np.minimum(1,t/.6)*np.minimum(1,(dur-t)/.6)
    return x*g
def m(nn): return 440*2**((nn-69)/12)
def noise(n): return rng.standard_normal(n)
def lp(x,a): # one-pole lowpass
    y=np.empty_like(x); s=0
    for i in range(len(x)): s+=a*(x[i]-s); y[i]=s
    return y
# ---------- music ----------
def bouncy(t0,t1,bpm=112,g=1.0,octave=0):
    b=60/bpm; prog=[(48,[60,64,67]),(53,[60,65,69]),(55,[59,62,67]),(48,[60,64,67])]
    mel=[72,None,76,74,72,None,67,None, 69,None,72,74,72,None,None,None, 71,None,74,None,79,77,74,None, 72,76,74,71,72,None,None,None]
    i=0;t=t0
    while t<t1-0.01:
        bar=(i//8)%4; root,ch=prog[bar]; step=i%8
        if step%2==0: add(mus,t,note(m(root+(7 if step%4==2 else 0)),b*.9,'bass',.30*g))
        if step in (1,3,5,7): 
            for c in ch: add(mus,t,note(m(c+octave),b*.4,'pluck',.07*g))
        mn=mel[i%32]
        if mn: add(mus,t,note(m(mn+octave),b*.9,'pluck',.13*g))
        # light shaker
        add(mus,t,noise(int(.03*SR))*env(int(.03*SR),.001,.01)*.05*g)
        i+=1;t+=b/2
def calm(t0,t1,g=1.0):
    bpm=84;b=60/bpm;prog=[[57,60,64,69],[53,57,60,65],[48,55,60,64],[55,59,62,67]]
    bar=0;t=t0
    while t<t1-0.05:
        ch=prog[bar%4];bl=min(4*b,t1-t)
        add(mus,t,note(m(ch[0]-12),bl,'pad',.10*g))
        for c in ch[1:]: add(mus,t,note(m(c),bl,'pad',.045*g))
        arp=[ch[0]+12,ch[2]+12,ch[3]+12,ch[1]+12,ch[2]+12,ch[3]+12,ch[1]+24,ch[3]+12]
        for k,a in enumerate(arp):
            if t+k*b/2<t1-.1: add(mus,t+k*b/2,note(m(a),1.2,'keys',.06*g))
        bar+=1;t+=4*b
def fade(buf,t0,t1,a=1,bb=0):
    i,j=int(t0*SR),int(t1*SR); buf[i:j]*=np.linspace(a,bb,j-i)
def mute(buf,t0,t1): buf[int(t0*SR):int(t1*SR)]=0

I=O['intro'];A=O['optA'];B=O['optB'];C=O['optC'];P=O['app'];E=O['ending']
bouncy(I+0.0,I+10.6)
fade(mus,I+10.2,I+10.6,1,0); mute(mus,I+10.6,I+13.5)
bouncy(A+0,A+11.4,g=.9); mute(mus,A+11.4,A+13.2); fade(mus,A+5.2,A+5.5,1,.35); mus[int((A+5.5)*SR):int((A+11.4)*SR)]*=.35
mute(mus,O['menuB'],O['menuB']+2.4)
bouncy(B+0,B+3.8,g=.85)
bouncy(B+3.8,B+10.6,bpm=190,g=.75,octave=12)
bouncy(B+10.6,B+16.8,g=.85); mute(mus,B+16.8,B+21)
mute(mus,O['menuC'],O['menuC']+2.4)
bouncy(C+0,C+6.2,g=.85); fade(mus,C+5.4,C+6.2,1,0)
calm(P+0.2,P+D['app']-.1,g=1.0); fade(mus,P,P+1.2,0,1); fade(mus,P+D['app']-1.0,P+D['app'],1,0)
bouncy(E+0,E+9.6,g=.9); fade(mus,E+9.2,E+9.6,1,.2); mute(mus,E+9.6,E+13)
for c in [48,55,60,64,67,72]: add(mus,E+9.6,note(m(c),3.4,'keys',.09))
for c in [72,76,79,84]: add(mus,E+10.2,note(m(c),2.8,'keys',.05))
# ---------- sfx ----------
def clink(t,g=.25):
    n=int(.25*SR);x=sum(np.sin(2*np.pi*f*tt(n))*np.exp(-tt(n)/d) for f,d in((2900,.08),(4100,.05),(5300,.04)));add(sfx,t,x*g/3)
def thud(t,g=.6,f=70,d=.18):
    n=int(.5*SR);tk=tt(n);x=np.sin(2*np.pi*f*tk*(1-tk*.6))*np.exp(-tk/d)+lp(noise(n),.08)*np.exp(-tk/.05)*.8;add(sfx,t,x*g)
def crash(t,g=.7):
    n=int(1.0*SR);x=lp(noise(n),.25)*np.exp(-tt(n)/.25);add(sfx,t,x*g);thud(t,.8,55,.3)
    for k in range(6): thud(t+.05+k*.07+rng.random()*.04,.35,140+rng.random()*120,.06)
def creak(t,g=.25):
    n=int(.6*SR);tk=tt(n);f=180+60*np.sin(tk*7);ph=2*np.cumsum(np.pi*f)/SR;x=np.sign(np.sin(ph))*np.sin(tk*np.pi/.6)*(.6+.4*np.sin(tk*90));add(sfx,t,lp(x,.2)*g)
def whoosh(t,dur=.45,g=.25):
    n=int(dur*SR);x=noise(n);a=np.linspace(.02,.4,n);y=np.empty(n);s=0
    for i in range(n): s+=a[i]*(x[i]-s);y[i]=s
    add(sfx,t,y*np.sin(np.pi*tt(n)/dur)*g)
def click(t,g=.35):
    n=int(.04*SR);add(sfx,t,noise(n)*np.exp(-tt(n)/.004)*g);add(sfx,t,np.sin(2*np.pi*1800*tt(n))*np.exp(-tt(n)/.01)*g*.5)
def ding(t,f=1320,g=.18):
    n=int(.8*SR);add(sfx,t,(np.sin(2*np.pi*f*tt(n))+.5*np.sin(2*np.pi*f*2*tt(n)))*np.exp(-tt(n)/.25)*g)
def scratch(t,g=.35):
    n=int(.35*SR);tk=tt(n);f=900-2200*tk;x=np.sin(2*np.pi*np.cumsum(f)/SR)*.5+lp(noise(n),.4);add(sfx,t,x*np.exp(-tk/.15)*g)
def rewind(t,dur,g=.22):
    n=int(dur*SR);tk=tt(n);f=600+500*np.sin(tk*30)+tk*400;x=np.sin(2*np.pi*np.cumsum(f)/SR)*.3+lp(noise(n),.5)*.5;add(sfx,t,x*np.minimum(1,tk/.1)*np.minimum(1,(dur-tk)/.1)*g)
def stampsfx(t): thud(t,.9,60,.2); add(sfx,t,lp(noise(int(.12*SR)),.5)*np.exp(-tt(int(.12*SR))/.03)*.5)
def step(t): thud(t,.18,90,.05)
def boing(t,g=.2):
    n=int(.6*SR);tk=tt(n);f=220+120*np.sin(tk*40)*np.exp(-tk*4);add(sfx,t,np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tk/.25)*g)
def tool(t):
    k=rng.integers(3)
    if k==0: clink(t,.2)
    elif k==1: thud(t,.3,200+rng.random()*200,.05)
    else: whoosh(t,.15,.12)
# intro
for k in range(12):
    tc=.6+k*.4+.2
    if tc<5.2: clink(I+tc,.22)
for k in range(5): step(I+5.7+k*.42)
creak(I+8.4,.3); crash(I+9.38); scratch(I+10.6)
whoosh(I+11.1,.5); click(I+12.1)
# optA
for at in (.6,1.6,2.6): ding(A+at+.3,1320+at*200,.2)
boing(A+5.4,.25); thud(A+9.2,.6,90,.08); clink(A+9.2,.15); thud(A+9.7,.5,60,.25)
stampsfx(A+10.3); rewind(A+11.4,1.8)
whoosh(O['menuB']+.1,.5); click(O['menuB']+1.0)
# optB
click(B+.3,.25)
tk=B+4.0
while tk<B+10.5: tool(tk); tk+=.11+rng.random()*.12
boing(B+11.2,.2); creak(B+16.2,.3); crash(B+17.0); stampsfx(B+18.0); rewind(B+19.2,1.8)
whoosh(O['menuC']+.1,.5); click(O['menuC']+1.0)
# optC
for k in range(3): ding(C+1.0+k*.9,1760,.07)
whoosh(C+4.6,1.4,.3)
# ending
creak(E+1.5,.12)
for k in range(3): ding(E+4.6+k*.15,2000+k*400,.1)
whoosh(E+6.0,.9,.15); clink(E+7.0,.35); clink(E+7.12,.2)
# mix
out=mus*0.9+sfx
out=np.tanh(out*1.1)*.85
out=out[:int(T*SR)]
st=np.stack([out,out],1)
pcm=(st*32767).astype(np.int16)
w=wave.open('/tmp/claude-0/vid/audio.wav','wb');w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(pcm.tobytes());w.close()
print(T, np.abs(out).max())
