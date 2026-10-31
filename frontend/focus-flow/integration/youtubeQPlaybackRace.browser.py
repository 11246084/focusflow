"""Loopback-only Q-E stale playback/course regression; no real backend/YouTube."""
import json
import os
import pathlib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(os.environ.get('YOUTUBE_Q_OUTPUT_DIR', 'output/playwright')).resolve()
BASE = 'http://127.0.0.1:5193'
MEDIA = (OUT / 'compatible.mp4').read_bytes()
COURSES = [{'_id': name, 'title': f'課程{name}', 'status': 'published', 'videoCount': 1} for name in ['A', 'B']]
VIDEOS = {name: {'_id': f'video{name}', 'title': f'原片{name}', 'videoSource': 'upload',
                 'sourceUrl': f'/api/v1/videos/video{name}/source', 'playbackSource': {'type': 'local'},
                 'processing': {'status': 'completed'}} for name in ['A', 'B']}
YOUTUBE = {**VIDEOS['A'], 'title': '過期的A回覆', 'videoSource': 'youtube',
           'youtubeVideoId': 'abc12345678', 'playbackSource': {'type': 'youtube'}}


def respond(route, data, status=200):
    route.fulfill(status=status, content_type='application/json',
                  body=json.dumps({'success': status < 400, 'data': data,
                                   **({'error': {'code': 'COURSE_ACCESS_DENIED'}} if status == 403 else {})}))


def wait_pending(page, state, key):
    for _ in range(100):
        if key in state['pending']:
            return state['pending'].pop(key)
        page.wait_for_timeout(30)
    raise AssertionError(f'expected delayed request {key}')


def make_page(browser, stage=None, hold_courses=False):
    state = {'pending': {}, 'armed': False, 'metadataLoads': 0, 'external': 0, 'holdCourses': hold_courses}
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""window.mockSeeks=[]; window.YT={PlayerState:{ENDED:0,PLAYING:1,PAUSED:2},
        Player:function(el,opts){const player={seekTo:t=>window.mockSeeks.push(t),playVideo:()=>{},destroy:()=>{}};
        setTimeout(()=>opts.events.onReady({target:player}),0);return player;}};""")

    def handler(route):
        request = route.request
        if not request.url.startswith(BASE + '/'):
            state['external'] += 1
            route.abort()
            return
        if '/api/v1/' not in request.url:
            route.continue_()
            return
        path = request.url.split('/api/v1/', 1)[1].split('?', 1)[0]
        if path == 'auth/me':
            respond(route, {'user': {'id': 'student1', 'role': 'student', 'name': '本機測試'}})
        elif path == 'courses':
            respond(route, {'courses': COURSES})
        elif path in ['courses/A/videos', 'courses/B/videos']:
            name = path.split('/')[1]
            if state['holdCourses']:
                state['pending'][f'course{name}'] = route
            else:
                respond(route, {'videos': [VIDEOS[name]]})
        elif path == 'videos/videoA' and state['armed']:
            state['metadataLoads'] += 1
            if stage == 'GET':
                state['pending']['GET'] = route
            else:
                respond(route, {'video': YOUTUBE})
        elif path in ['videos/videoA/source', 'videos/videoB/source']:
            if request.method == 'HEAD':
                if state['armed'] and path == 'videos/videoA/source':
                    if stage == 'HEAD':
                        state['pending']['HEAD'] = route
                    else:
                        route.fulfill(status=409)
                else:
                    route.fulfill(status=200)
                return
            start, end = 0, len(MEDIA) - 1
            byte_range = request.headers.get('range')
            if byte_range:
                first, last = byte_range.removeprefix('bytes=').split('-')
                start = int(first or 0)
                end = min(int(last) if last else end, end)
            headers = {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': str(end - start + 1)}
            if byte_range:
                headers['Content-Range'] = f'bytes {start}-{end}/{len(MEDIA)}'
            route.fulfill(status=206 if byte_range else 200, headers=headers, body=MEDIA[start:end + 1])
        else:
            respond(route, {})

    context.route('**/*', handler)
    page.goto(BASE + '/app/courses')
    page.locator('.course-row').filter(has_text='課程A').wait_for()
    return context, page, state, errors


def enter(page, name, select=True):
    page.locator('.course-row').filter(has_text=f'課程{name}').get_by_role('button', name='進入課程').click()
    if select:
        page.locator('.vid-row').filter(has_text=f'原片{name}').click()
        page.wait_for_function("document.querySelector('video')?.readyState >= 1")


def assert_current(page, name, errors):
    assert page.locator('.course-study-name').inner_text() == f'課程{name}'
    assert page.locator('video').get_attribute('src') == f'/api/v1/videos/video{name}/source'
    assert page.locator('.course-player [role=status]').count() == 0
    assert page.evaluate('window.mockSeeks') == []
    assert not errors, errors


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=os.environ['QE_BROWSER'])
    label = os.environ.get('QE_BROWSER_LABEL', 'chrome')
    cases = []
    for stage, outcome, reenter in [('HEAD', 409, False), ('HEAD', 403, False),
                                    ('GET', 200, False), ('GET', 403, False), ('GET', 200, True)]:
        context, page, state, errors = make_page(browser, stage=stage)
        enter(page, 'A')
        state['armed'] = True
        page.locator('video').evaluate("el => {el.currentTime=3; el.dispatchEvent(new Event('error'));}")
        pending = wait_pending(page, state, stage)
        page.get_by_role('button', name='返回課程列表').click()
        enter(page, 'B')
        current = 'B'
        if reenter:
            page.get_by_role('button', name='返回課程列表').click()
            enter(page, 'A')
            current = 'A'
        # Keep the current video paused at a distinct time; an old seek must not land here.
        page.locator('video').evaluate('el => {el.pause(); el.currentTime=1;}')
        if stage == 'HEAD':
            pending.fulfill(status=outcome)
        else:
            respond(pending, {'video': YOUTUBE}, status=outcome)
        page.wait_for_timeout(200)
        assert_current(page, current, errors)
        assert abs(page.locator('video').evaluate('el => el.currentTime') - 1) < .1
        assert state['metadataLoads'] == (0 if stage == 'HEAD' else 1)
        cases.append(f'{stage}-{outcome}-A-B' + ('-A' if reenter else ''))
        if reenter:
            page.screenshot(path=str(OUT / f'qe-race-{label}.png'), full_page=True)
        context.close()

    for keep_b_loading in [False, True]:
        context, page, state, errors = make_page(browser, hold_courses=True)
        enter(page, 'A', select=False)
        old = wait_pending(page, state, 'courseA')
        page.get_by_role('button', name='返回課程列表').click()
        enter(page, 'B', select=False)
        current = wait_pending(page, state, 'courseB')
        if not keep_b_loading:
            respond(current, {'videos': [VIDEOS['B']]})
            page.locator('.vid-row').filter(has_text='原片B').wait_for()
        respond(old, {'videos': [VIDEOS['A']]})
        page.wait_for_timeout(200)
        assert page.locator('.course-study-name').inner_text() == '課程B'
        assert page.locator('.vid-row').filter(has_text='原片A').count() == 0
        if keep_b_loading:
            assert page.locator('.course-playlist').get_by_text('載入中…').count() == 1
            respond(current, {'videos': [VIDEOS['B']]})
        page.locator('.vid-row').filter(has_text='原片B').click()
        page.wait_for_function("document.querySelector('video')?.readyState >= 1")
        assert_current(page, 'B', errors)
        cases.append('course-A-late-' + ('B-loading' if keep_b_loading else 'B-ready'))
        context.close()
    browser.close()
    result = {'browser': label, 'passed': len(cases), 'cases': cases,
              'scope': 'Vite loopback + intercepted fake API/media; external requests aborted'}
    (OUT / f'qe-race-{label}.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
