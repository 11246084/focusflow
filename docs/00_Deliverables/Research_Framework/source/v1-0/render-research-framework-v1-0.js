// Playwright MCP browser_run_code_unsafe filename input: async function(page).
// Requires preview-server-v1-0.mjs at localhost:8794; update outputDir if relocated.
async (page) => {
  const outputDir='C:/Users/User/Documents/GitHub/focusflow/docs/00_Deliverables/Research_Framework/results/v1-0';
  const stem='focusflow-research-framework-v1-0';
  const browser=page.context().browser();
  const context=await browser.newContext({viewport:{width:1280,height:1776},deviceScaleFactor:2});
  const renderPage=await context.newPage();
  try {
    await renderPage.goto('http://127.0.0.1:8794');
    await renderPage.evaluate(()=>document.fonts.ready);
    const audit=await renderPage.evaluate(()=>{
      const svg=document.querySelector('svg');
      const texts=[...svg.querySelectorAll('text')];
      const boxes=texts.map(t=>({t,b:t.getBBox()}));
      const xml=new DOMParser().parseFromString(svg.outerHTML,'image/svg+xml');
      return {
        textCount:texts.length,
        panelCount:svg.querySelectorAll('[data-panel]').length,
        fontFamily:getComputedStyle(texts[0]).fontFamily,
        localFontAvailable:document.fonts.check('18px "Microsoft JhengHei"'),
        xmlValid:xml.querySelector('parsererror')===null,
        accessibleTitle:svg.firstElementChild.tagName==='title',
        accessibleReferences:svg.getAttribute('aria-labelledby').split(' ').every(id=>document.getElementById(id)),
        rasterImages:svg.querySelectorAll('image').length,
        overflow:texts.filter(t=>t.dataset.maxWidth && t.getBBox().width>Number(t.dataset.maxWidth)+1).map(t=>t.textContent),
        outsideCanvas:boxes.filter(({b})=>b.x<0||b.y<0||b.x+b.width>1280||b.y+b.height>1776).map(({t})=>t.textContent),
        outsidePanel:boxes.filter(({t,b})=>{
          const g=t.closest('[data-panel]');if(!g)return false;
          const [x,y,w,h]=g.dataset.panel.split(',').map(Number);
          return b.x<x||b.y<y||b.x+b.width>x+w||b.y+b.height>y+h;
        }).map(({t})=>t.textContent),
        textCollisions:boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>a.b.x<b.b.x+b.b.width && a.b.x+a.b.width>b.b.x && a.b.y<b.b.y+b.b.height && a.b.y+a.b.height>b.b.y).map(b=>[a.t.textContent,b.t.textContent])),
        remoteResources:performance.getEntriesByType('resource').filter(e=>!e.name.startsWith('http://127.0.0.1:8794')).map(e=>e.name),
      };
    });
    if(audit.overflow.length||audit.outsideCanvas.length||audit.outsidePanel.length||audit.textCollisions.length||!audit.xmlValid||audit.panelCount!==7)throw new Error(JSON.stringify(audit));
    await renderPage.locator('svg').screenshot({path:`${outputDir}/${stem}.png`,scale:'device'});
    await renderPage.pdf({path:`${outputDir}/${stem}.pdf`,preferCSSPageSize:true,printBackground:true});
    return {renderer:'Playwright MCP / Chromium',browserVersion:browser.version(),viewport:{width:1280,height:1776},deviceScaleFactor:2,pngSize:{width:2560,height:3552},audit};
  } finally {await context.close();}
}
