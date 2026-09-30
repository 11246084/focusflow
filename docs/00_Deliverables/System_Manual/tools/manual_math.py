"""Convert the existing manual's LaTeX subset to editable Word equations.

Uses Microsoft's installed MathML transform. Unsupported commands fail rather
than silently producing a changed formula. No formula values are generated.
"""
import re
from pathlib import Path
from lxml import etree

NS='http://www.w3.org/1998/Math/MathML'
XSL=Path('C:/Program Files/Microsoft Office/root/Office16/MML2OMML.XSL')
TRANSFORM=etree.XSLT(etree.parse(str(XSL)))

def element(tag,*children,text=None,**attrs):
    node=etree.Element('{'+NS+'}'+tag,**attrs)
    if text is not None:node.text=text
    node.extend(children)
    return node

class Parser:
    def __init__(self,text):
        self.tokens=re.findall(r'\\[A-Za-z]+|\\.|[0-9]+(?:\.[0-9]+)?|[^\s]',text)
        self.i=0
    def group(self):
        if self.tokens[self.i]=='{':
            self.i+=1;parts=[]
            while self.i<len(self.tokens) and self.tokens[self.i]!='}':parts.append(self.atom())
            if self.i>=len(self.tokens):raise ValueError('Unclosed LaTeX group')
            self.i+=1;return element('mrow',*parts)
        return self.atom(scripts=False)
    def atom(self,scripts=True):
        token=self.tokens[self.i];self.i+=1
        if token=='{':self.i-=1;node=self.group()
        elif token==r'\frac':node=element('mfrac',self.group(),self.group())
        elif token==r'\sqrt':node=element('msqrt',self.group())
        elif token in [r'\mathrm',r'\mathbf']:
            node=self.group();node.set('mathvariant','normal' if token==r'\mathrm' else 'bold')
            for child in node.iter():
                if etree.QName(child).localname=='mi':child.set('mathvariant','normal' if token==r'\mathrm' else 'bold')
        elif token in [r'\left',r'\right']:node=self.atom(scripts=False)
        elif token in [r'\,',r'\;',r'\quad',r'\qquad']:
            node=element('mspace',width='0.2em' if token in [r'\,',r'\;'] else '1em')
        elif token==r'\cos':node=element('mi',text='cos',mathvariant='normal')
        elif token.startswith('\\'):
            symbols={r'\times':'×',r'\div':'÷',r'\approx':'≈',r'\le':'≤',r'\ge':'≥',r'\cdot':'⋅',r'\sum':'∑',r'\lceil':'⌈',r'\rceil':'⌉',r'\lVert':'‖',r'\rVert':'‖',r'\Rightarrow':'⇒'}
            if token not in symbols:raise ValueError('Unsupported LaTeX: '+token)
            node=element('mo',text=symbols[token])
        elif token[0].isdigit():node=element('mn',text=token)
        elif token.isalpha():node=element('mi',text=token)
        else:node=element('mo',text=token)
        if scripts:
            sub=sup=None
            while self.i<len(self.tokens) and self.tokens[self.i] in ['_','^']:
                op=self.tokens[self.i];self.i+=1;value=self.group()
                if op=='_':sub=value
                else:sup=value
            if sub is not None and sup is not None:node=element('msubsup',node,sub,sup)
            elif sub is not None:node=element('msub',node,sub)
            elif sup is not None:node=element('msup',node,sup)
        return node
    def parse(self):
        out=[]
        while self.i<len(self.tokens):out.append(self.atom())
        return element('math',element('mrow',*out))

def omml(latex):
    return TRANSFORM(Parser(latex).parse()).getroot()

INLINE=re.compile(r'(?<![A-Za-z0-9\\])\$([^$\n]+?)(?<!\\)\$')

def install_inline(layout):
    original=layout.add_inline
    def add(paragraph,text,**kwargs):
        cursor=0
        for match in INLINE.finditer(text):
            original(paragraph,text[cursor:match.start()].replace(r'\$','$'),**kwargs)
            paragraph._p.append(omml(match.group(1)))
            cursor=match.end()
        original(paragraph,text[cursor:].replace(r'\$','$'),**kwargs)
    layout.add_inline=add
