import sys,re,glob; sys.path.insert(0,'../review')
from analyze_blocks import blocks
def elements(f):
    B=blocks(f); N=len(B); els=[];k=0
    while k<N:
        t,x=B[k]
        if t=='image':
            j=k+1
            if j<N and B[j][0]=='cap': j+=1
            els.append(('fig',B[j-1][1] if j>k+1 else x,k)); k=j; continue
        if t=='cap' and k+1<N and B[k+1][0]=='table': els.append(('tab',x,k)); k+=2; continue
        if t=='cap' and k+1<N and B[k+1][0]=='image': els.append(('fig',x,k)); k+=2; continue
        if t=='table': els.append(('tab','(no caption) '+x,k)); k+=1; continue
        els.append((t,x,k)); k+=1
    return els
if __name__=='__main__':
    only=sys.argv[1:] 
    for f in sorted(glob.glob('[0-9][0-9]_*.md')):
        if only and f[:2] not in only: continue
        els=elements(f)
        print('==',f)
        for i,(t,x,k) in enumerate(els):
            if t in('fig','tab') and i:
                p=els[i-1]
                if p[0] in('fig','tab'): print('  STACK:',p[1][:50],'=>',x[:50])
                elif p[0]=='h': print('  HEAD :',p[1][:40],'=>',x[:50])
