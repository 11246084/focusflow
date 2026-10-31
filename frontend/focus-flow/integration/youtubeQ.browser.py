import json, pathlib, os
from playwright.sync_api import sync_playwright
OUT=pathlib.Path(os.environ.get('YOUTUBE_Q_OUTPUT_DIR', 'output/playwright')).resolve()
media=(OUT/'compatible.mp4').read_bytes()
state={'role':'student','probe':0,'privacy':0,'switched':False}
course={'_id':'course1','title':'測試課程','description':'本機假資料','status':'published','videoCount':2}
videos=[{'_id':'video1','title':'相容原片','videoSource':'upload','sourceUrl':'/api/v1/videos/video1/source','playbackSource':{'type':'local'},'processing':{'status':'completed'}}, {'_id':'video2','title':'不相容原片','videoSource':'upload','playbackSource':{'type':'unavailable'},'processing':{'status':'completed'}}]
def handler(route):
    request=route.request; url=request.url
    if not url.startswith('http://127.0.0.1:5193/'):
        route.abort(); return
    if '/api/v1/' not in url:
        route.continue_(); return
    p=url.split('/api/v1/',1)[1].split('?',1)[0]
    data={}
    if p=='auth/me': data={'user':{'id':state['role']+'1','role':state['role'],'name':'測試帳號'}}
    elif p=='courses': data={'courses':[course]}
    elif p=='courses/course1/videos': data={'videos':videos}
    elif p=='stats/student': data={'courseList':[]}
    elif p=='videos/upload-status': data={'pause':{'paused':True,'earliestRetryAt':'2026-11-01T00:00:00Z'}}
    elif p=='videos/upload-storage': data={'availableBytes':1024**3,'reservedBytes':0,'freeBytes':2*1024**3,'minimumFreeBytes':1024**3}
    elif p=='admin/youtube-lifecycle/settings': data={'switches':[{'key':k,'envAllowed':True,'effective':False,'runtimeEnabled':False} for k in ['upload','recovery','cleanup','privacy_guard']],'runtime':{}}
    elif p.startswith('admin/youtube-lifecycle/cleanup-preview'): data={'items':[],'count':0}
    elif p=='admin/youtube-quarantine': data={'items':[],'searchable':True}
    elif p=='admin/youtube-lifecycle/uploads': data={'pause':{'paused':True,'earliestRetryAt':'2026-11-01T00:00:00Z','probe':None},'waitingCount':1,'uploadingCount':0,'successLast24Hours':2,'items':[{'kind':'video','id':'v1','title':'測試待傳影片','status':'waiting','orphanUploads':[{'attemptId':'a','youtubeVideoId':'abc12345678'}]}]}
    elif p=='admin/youtube-lifecycle/uploads/probe': state['probe']+=1; data={'attempted':True,'succeeded':True}
    elif p=='admin/youtube-lifecycle/privacy-incidents': data={'items':[{'kind':'video','id':'v1','title':'隱私測試影片','detectedAt':'2026-10-28T00:00:00Z','observed':'public','action':'detected','result':'public','privacyStatus':'public'}]}
    elif p=='admin/youtube-lifecycle/privacy/video/v1/unlisted': state['privacy']+=1; data={'kind':'video','id':'v1','privacyStatus':'unlisted'}
    elif p=='admin/youtube-lifecycle/storage': data={'availableBytes':1024**3,'reservedBytes':1024,'pendingLocalBytes':1024**2,'unreadableLocalCount':0,'blocked':[]}
    elif p=='videos/video1' and state['switched']: data={'video':{'_id':'video1','title':'相容原片','videoSource':'youtube','youtubeVideoId':'abc12345678','playbackSource':{'type':'youtube'}}}
    elif p=='videos/video1/source':
        if request.method=='HEAD' and state['switched']: route.fulfill(status=409); return
        if request.method=='HEAD': route.fulfill(status=200,headers={'Content-Type':'video/mp4','Content-Length':str(len(media)),'Accept-Ranges':'bytes'}); return
        hdr=request.headers.get('range'); start=0; end=len(media)-1
        if hdr:
            part=hdr.removeprefix('bytes=').split('-'); start=int(part[0] or 0); end=min(int(part[1]) if part[1] else end,end)
        headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':str(end-start+1)}
        if hdr: headers['Content-Range']=f'bytes {start}-{end}/{len(media)}'
        route.fulfill(status=206 if hdr else 200,headers=headers,body=media[start:end+1]); return
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'success':True,'data':data},ensure_ascii=False))
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **({'executable_path': os.environ['QE_BROWSER']} if os.environ.get('QE_BROWSER') else {}))
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.route('**/*',handler)
    state['role']='teacher'; page.goto('http://127.0.0.1:5193/app/upload'); page.get_by_text('YouTube 上傳暫停中').wait_for(); page.get_by_text('目前可用於上傳').wait_for(); page.screenshot(path=str(OUT/('teacher-'+os.environ.get('QE_BROWSER_LABEL','chromium')+'.png')),full_page=True)
    page.close(); page=browser.new_page(viewport={'width':1440,'height':900}); page.route('**/*',handler)
    state['role']='admin'; page.goto('http://127.0.0.1:5193/admin/youtube'); page.get_by_text('測試待傳影片').wait_for(); page.get_by_role('button',name='提前檢查並嘗試恢復').click(); page.get_by_text('試傳成功').wait_for(); assert state['probe']==1
    page.get_by_role('button',name='改回不公開').click(); page.get_by_role('button',name='確認改回').click(); page.get_by_text('已提交隱私修復').wait_for(); assert state['privacy']==1; page.screenshot(path=str(OUT/('admin-'+os.environ.get('QE_BROWSER_LABEL','chromium')+'.png')),full_page=True)
    page.close(); page=browser.new_page(viewport={'width':1440,'height':900}); page.route('**/*',handler)
    page.add_init_script("window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 }, Player: function(el,opts) { window.mockOptions=opts; const player={seekTo:(time)=>{window.mockSeek=time}, playVideo:()=>{}, destroy:()=>{}}; setTimeout(()=>opts.events.onReady({target:player}),0); return player; } };")
    state['role']='student'; page.goto('http://127.0.0.1:5193/app/courses'); page.get_by_role('button',name='進入課程').click(); page.locator('.vid-row').nth(0).click(); video=page.locator('video'); video.wait_for(); video.evaluate('(e) => e.play()'); page.wait_for_function("document.querySelector('video')?.currentTime > 0.2"); video.evaluate('(e) => { e.currentTime = 3; }'); page.wait_for_function("document.querySelector('video')?.currentTime >= 3"); page.screenshot(path=str(OUT/('student-compatible-'+os.environ.get('QE_BROWSER_LABEL','chromium')+'.png')),full_page=True)
    state['switched']=True; video.evaluate("e => e.dispatchEvent(new Event('error'))"); page.wait_for_function('window.mockSeek >= 3'); print('OK: 409 refreshed metadata and resumed YouTube at saved time')
    for code in [100, 101, 150]:
        page.evaluate('(code) => window.mockOptions.events.onError({data:code})', code)
        page.get_by_text('YouTube 找不到這支影片' if code == 100 else 'YouTube 不允許在此播放').wait_for()
        page.locator('button[aria-controls=course-playlist]').first.click(); page.locator('.vid-row').nth(0).click()
        page.wait_for_function('window.mockOptions != null')
    print('OK: YouTube 100/101/150 error messages')
    page.locator('button[aria-controls=course-playlist]').first.click(); page.locator('.vid-row').nth(1).click(); page.get_by_text('影片準備中，可先提問').wait_for(); page.screenshot(path=str(OUT/('student-incompatible-'+os.environ.get('QE_BROWSER_LABEL','chromium')+'.png')),full_page=True)
    print('OK: teacher pause/storage, admin probe/privacy, student compatible play+seek and unavailable message; screenshots:', OUT)
    browser.close()
