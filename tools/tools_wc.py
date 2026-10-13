# procedural watercolour assets (numpy): soft translucent pigment pools with darker drying edges,
# granulation, paper grain; layered overlapping shapes like the H.O.W logo. Output: alpha WebP.
import numpy as np, sys
from PIL import Image, ImageFilter
OUT='/workspace/pc-tryon-deploy/assets/wc/'; rng=np.random.default_rng(7)
P={'peach':(240,168,140),'pink':(228,146,160),'sage':(150,184,166),'navy':(44,58,98),'lav':(170,168,206),'ochre':(214,170,112),'rose':(222,128,140),'mist':(176,196,222)}
def noise(h,w,oct=5,base=4):
    out=np.zeros((h,w)); amp=1; tot=0
    for o in range(oct):
        n=base*2**o; g=rng.random((n+1,n+1)); im=Image.fromarray((g*255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
        out+=amp*np.asarray(im)/255; tot+=amp; amp*=0.5
    return out/tot
def blob(h,w,cx,cy,rx,ry,rot=0,wob=0.18,seed=None):
    yy,xx=np.mgrid[0:h,0:w]; X=(xx-cx); Y=(yy-cy); c,s=np.cos(rot),np.sin(rot)
    u=(X*c+Y*s)/rx; v=(-X*s+Y*c)/ry; r=np.sqrt(u*u+v*v)
    n=noise(h,w,4,3); return r+(n-0.5)*2*wob
def pigment(h,w,d,col,a=0.55,edge=0.5,soft=0.04):
    m=np.clip((1-d)/soft,0,1)  # inside
    rim=np.exp(-((d-1)/0.06)**2)*(d<1.02)
    gran=noise(h,w,3,max(8,w//10)); fl=noise(h,w,3,2)
    al=m*(a*(0.65+0.45*fl)*(0.85+0.3*gran))+rim*edge*a*0.6
    return np.clip(al,0,1),np.array(col,float)
def comp(h,w,layers):
    Wp=np.ones((h,w,3))
    for al,col in layers:   # transparent glaze on white paper: each layer filters light, overlaps stay luminous
        Cn=np.array(col)/255; Wp=Wp*(1-al[...,None]*0.85*(1-Cn))
    D=1-Wp; A=np.clip(D.max(-1)/0.62,0,1)
    C=np.clip(1-D/np.maximum(A[...,None],1e-3),0,1)
    return C,A
def save(C,A,name,q=82,blur=0.6):
    im=Image.fromarray(np.dstack([np.clip(C*255,0,255),A*255]).astype(np.uint8),'RGBA')
    if blur: im=im.filter(ImageFilter.GaussianBlur(blur))
    im.save(OUT+name,'WEBP',quality=q,method=6); import os; print(name,im.size,os.path.getsize(OUT+name)//1024,'KB')
def C_(h,w,specs):
    L=[]
    for (cx,cy,rx,ry,rot,col,a) in specs:
        L.append(pigment(h,w,blob(h,w,cx*w,cy*h,rx*w,ry*h,rot),P[col],a))
    return comp(h,w,L)
# 1 large corner washes (page/cover/sheet backgrounds)
h=w=720
save(*C_(h,w,[(0.22,0.18,0.42,0.30,0.5,'peach',0.36),(0.10,0.42,0.26,0.34,-0.3,'pink',0.30),(0.40,0.06,0.30,0.16,0.2,'sage',0.30)]),'wash-tl.webp',q=74,blur=1.2)
save(*C_(h,w,[(0.80,0.84,0.40,0.28,0.4,'sage',0.34),(0.92,0.62,0.22,0.34,-0.2,'navy',0.20),(0.62,0.95,0.30,0.14,0.1,'pink',0.26)]),'wash-br.webp',q=74,blur=1.2)
# 2 season pools (badges, cover tones, type cards)
S={'spring':[('peach',0.62),('pink',0.42)],'summer':[('mist',0.6),('lav',0.45)],'autumn':[('ochre',0.6),('sage',0.42)],'winter':[('navy',0.62),('lav',0.40)]}
for k,(a,b) in S.items():
    h=w=144; save(*C_(h,w,[(0.45,0.50,0.36,0.40,0.6,a[0],a[1]),(0.60,0.46,0.28,0.32,-0.5,b[0],b[1])]),f'season-{k}.webp',q=86)
# 3 soft strip for cards / toasts / dialogs
h,w=180,720; save(*C_(h,w,[(0.10,0.30,0.14,0.55,0.1,'peach',0.5),(0.22,0.15,0.12,0.40,0.0,'sage',0.45),(0.90,0.75,0.13,0.5,0.2,'pink',0.45)]),'strip.webp',q=74,blur=1)
# 4 placeholder face-ish illustration: overlapping O + two pools
h=w=240; save(*C_(h,w,[(0.42,0.5,0.30,0.38,0.35,'peach',0.5),(0.58,0.5,0.30,0.38,-0.35,'sage',0.44),(0.5,0.58,0.22,0.24,0.0,'navy',0.22)]),'ph.webp',q=84)
