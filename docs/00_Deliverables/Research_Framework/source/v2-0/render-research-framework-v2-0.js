// Input for Playwright MCP browser_run_code_unsafe(filename=...).
async (page)=>{
  const outputDir='C:/Users/User/Documents/GitHub/focusflow/docs/00_Deliverables/Research_Framework/results/v2-0';
  const stem='focusflow-research-framework-v2-0';
  const browser=page.context().browser();
  const context=await browser.newContext({viewport:{width:1100,height:1116},deviceScaleFactor:3});
  const p=await context.newPage();
  try{
    await p.goto('http://localhost:8795');await p.evaluate(()=>document.fonts.ready);
    const audit=await p.evaluate(()=>{
      const svg=document.querySelector('svg'),ts=[...svg.querySelectorAll('text')],bs=ts.map(t=>({t,b:t.getBBox()}));
      return {textCount:ts.length,xmlValid:!new DOMParser().parseFromString(svg.outerHTML,'image/svg+xml').querySelector('parsererror'),fontFamily:getComputedStyle(ts[0]).fontFamily,minimumFontPx:Math.min(...ts.map(t=>parseFloat(getComputedStyle(t).fontSize))),
        rasterImageCount:svg.querySelectorAll('image').length,
        overflow:ts.filter(t=>t.dataset.maxWidth&&t.getBBox().width>+t.dataset.maxWidth+1).map(t=>t.textContent),
        textCollisions:bs.flatMap((a,i)=>bs.slice(i+1).filter(b=>a.b.x<b.b.x+b.b.width&&a.b.x+a.b.width>b.b.x&&a.b.y<b.b.y+b.b.height&&a.b.y+a.b.height>b.b.y).map(b=>[a.t.textContent,b.t.textContent])),
        outside:bs.filter(({b})=>b.x<0||b.y<0||b.x+b.width>1100||b.y+b.height>1116).map(({t})=>t.textContent),
        remoteResources:performance.getEntriesByType('resource').filter(e=>!e.name.startsWith('http://localhost:8795')).map(e=>e.name),
        rect:{width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height},devicePixelRatio:window.devicePixelRatio};
    });
    if(audit.overflow.length||audit.textCollisions.length||audit.outside.length||!audit.xmlValid)throw Error(JSON.stringify(audit));
    if(Math.abs(audit.devicePixelRatio-3)>0.01)throw Error('Browser zoom must be 100% for a correctly cropped export.');
    await p.locator('svg').screenshot({path:`${outputDir}/${stem}.png`,scale:'device'});
    await p.pdf({path:`${outputDir}/${stem}.pdf`,preferCSSPageSize:true,printBackground:true});
    await p.goto('http://localhost:8795/chapter');await p.evaluate(()=>document.fonts.ready);
    const placement=await p.evaluate(()=>({widthMm:160,pageWidthPx:document.querySelector('.page').getBoundingClientRect().width,pageHeightPx:document.querySelector('.page').getBoundingClientRect().height,figureWidthPx:document.querySelector('svg').getBoundingClientRect().width,figureHeightPx:document.querySelector('svg').getBoundingClientRect().height}));
    await p.locator('.page').screenshot({path:`${outputDir}/chapter03-placement-v2-0.png`,scale:'css'});
    await p.pdf({path:`${outputDir}/chapter03-placement-v2-0.pdf`,preferCSSPageSize:true,printBackground:true});
    return {browser:browser.version(),deviceScaleFactor:3,audit,placement};
  }finally{await context.close();}
}
