"""List figures/tables that lack a bridging prose paragraph before and/or after them (chapters/*.md)."""
import re, glob, sys
def blocks(path):
    L=open(path,encoding='utf-8').read().split('\n'); i=0; out=[]
    while i<len(L):
        t=L[i].strip(); i+=1
        if not t or t=='---': continue
        if t.startswith('#'): out.append(('h',t)); continue
        if t.startswith('```'):
            while i<len(L) and not L[i].strip().startswith('```'): i+=1
            i+=1; out.append(('code',''));continue
        if t.startswith('|'):
            rows=[t]
            while i<len(L) and L[i].strip().startswith('|'): rows.append(L[i]); i+=1
            out.append(('table',str(len(rows)-2)+' rows | '+rows[0][:50])); continue
        if re.match(r'^!\[',t): out.append(('image',t[:60])); continue
        if re.match(r'^(圖|表|附圖|附表)\s*\d',t) and len(t)<90 and not re.search('[。；，]',t): out.append(('cap',t)); continue
        if t.startswith('$$') : out.append(('eq',t)); continue
        out.append(('p',t))
    return out
if __name__=='__main__':
    for f in sorted(glob.glob('[0-9][0-9]_*.md')):
        B=blocks(f); N=len(B)
        def prose(k):  # is block k a real prose paragraph (>=30 chars, not list/notation)?
            return 0<=k<N and B[k][0]=='p' and len(B[k][1])>=30
        res=[]
        for k,(ty,tx) in enumerate(B):
            if ty in ('table','image'):
                # find caption position
                cap_k = k-1 if (ty=='table' and k>0 and B[k-1][0]=='cap') else (k+1 if (ty=='image' and k+1<N and B[k+1][0]=='cap') else None)
                first = cap_k if (cap_k is not None and cap_k<k) else k
                last  = cap_k if (cap_k is not None and cap_k>k) else k
                before=prose(first-1); after=prose(last+1)
                # stacked: previous block (before first) is also caption/table/image end
                res.append((k,ty,tx if ty!='image' else B[cap_k][1] if cap_k else tx,before,after,B[first-1][0] if first>0 else '-',B[last+1][0] if last+1<N else '-'))
        bad=[r for r in res if not (r[3] and r[4])]
        print(f'== {f}: {len(res)} figure/table blocks; {len(bad)} lacking before/after prose')
        if '-v' in sys.argv:
            for r in bad: print('   ',r[1],r[2][:60],'| before',r[5],'after',r[6])
