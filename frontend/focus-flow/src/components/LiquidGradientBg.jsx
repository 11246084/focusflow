import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ── TouchTexture ──────────────────────────────────────────────────────────────
class TouchTexture {
  constructor() {
    this.size   = 64;
    this.maxAge = 64;
    this.r      = 0.25 * this.size;
    this.trail  = [];
    this.last   = null;

    this.cvs        = document.createElement('canvas');
    this.cvs.width  = this.cvs.height = this.size;
    this.c          = this.cvs.getContext('2d');
    this.c.fillStyle = 'black';
    this.c.fillRect(0, 0, this.size, this.size);
    this.tex        = new THREE.Texture(this.cvs);
  }

  update() {
    this.c.fillStyle = 'black';
    this.c.fillRect(0, 0, this.size, this.size);
    const spd = 1 / this.maxAge;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      const f = p.force * spd * (1 - p.age / this.maxAge);
      p.x += p.vx * f; p.y += p.vy * f; p.age++;
      if (p.age > this.maxAge) { this.trail.splice(i, 1); continue; }
      this._draw(p);
    }
    this.tex.needsUpdate = true;
  }

  add(pt) {
    let vx = 0, vy = 0, force = 0;
    if (this.last) {
      const dx = pt.x - this.last.x, dy = pt.y - this.last.y;
      if (!dx && !dy) return;
      const d = Math.sqrt(dx * dx + dy * dy);
      vx = dx / d; vy = dy / d;
      force = Math.min((dx * dx + dy * dy) * 20000, 2);
    }
    this.last = { x: pt.x, y: pt.y };
    this.trail.push({ x: pt.x, y: pt.y, age: 0, force, vx, vy });
  }

  _draw(p) {
    const pos = { x: p.x * this.size, y: (1 - p.y) * this.size };
    let I = p.age < this.maxAge * 0.3
      ? Math.sin((p.age / (this.maxAge * 0.3)) * (Math.PI / 2))
      : -(1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)) *
        ((1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)) - 2);
    I *= p.force;
    const col = `${((p.vx + 1) / 2) * 255},${((p.vy + 1) / 2) * 255},${I * 255}`;
    const off = this.size * 5;
    this.c.shadowOffsetX = off; this.c.shadowOffsetY = off;
    this.c.shadowBlur    = this.r;
    this.c.shadowColor   = `rgba(${col},${0.2 * I})`;
    this.c.beginPath();
    this.c.fillStyle = 'rgba(255,0,0,1)';
    this.c.arc(pos.x - off, pos.y - off, this.r, 0, Math.PI * 2);
    this.c.fill();
  }

  reset() { this.last = null; }
}

// ── Shaders ───────────────────────────────────────────────────────────────────
const VERT = `varying vec2 vUv;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);vUv=uv;}`;

const FRAG = `
  uniform float uTime;
  uniform vec2  uRes;
  uniform vec3  uC1,uC2,uC3,uC4,uC5,uC6,uNav;
  uniform float uSpd,uInt,uGr,uGS,uW1,uW2;
  uniform sampler2D uTex;
  varying vec2 vUv;

  float grain(vec2 u,float t){
    vec2 g=u*uRes*.5;
    return fract(sin(dot(g+t,vec2(12.9898,78.233)))*43758.5453)*2.-1.;
  }

  vec3 getC(vec2 uv,float t){
    float gr=uGS;
    vec2 c1 =vec2(.5+sin(t*uSpd*.4 )*.4 ,.5+cos(t*uSpd*.5 )*.4 );
    vec2 c2 =vec2(.5+cos(t*uSpd*.6 )*.5 ,.5+sin(t*uSpd*.45)*.5 );
    vec2 c3 =vec2(.5+sin(t*uSpd*.35)*.45,.5+cos(t*uSpd*.55)*.45);
    vec2 c4 =vec2(.5+cos(t*uSpd*.5 )*.4 ,.5+sin(t*uSpd*.4 )*.4 );
    vec2 c5 =vec2(.5+sin(t*uSpd*.7 )*.35,.5+cos(t*uSpd*.6 )*.35);
    vec2 c6 =vec2(.5+cos(t*uSpd*.45)*.5 ,.5+sin(t*uSpd*.65)*.5 );
    vec2 c7 =vec2(.5+sin(t*uSpd*.55)*.38,.5+cos(t*uSpd*.48)*.42);
    vec2 c8 =vec2(.5+cos(t*uSpd*.65)*.36,.5+sin(t*uSpd*.52)*.44);
    vec2 c9 =vec2(.5+sin(t*uSpd*.42)*.41,.5+cos(t*uSpd*.58)*.39);
    vec2 c10=vec2(.5+cos(t*uSpd*.48)*.37,.5+sin(t*uSpd*.62)*.43);

    float i1 =1.-smoothstep(0.,gr,length(uv-c1 ));
    float i2 =1.-smoothstep(0.,gr,length(uv-c2 ));
    float i3 =1.-smoothstep(0.,gr,length(uv-c3 ));
    float i4 =1.-smoothstep(0.,gr,length(uv-c4 ));
    float i5 =1.-smoothstep(0.,gr,length(uv-c5 ));
    float i6 =1.-smoothstep(0.,gr,length(uv-c6 ));
    float i7 =1.-smoothstep(0.,gr,length(uv-c7 ));
    float i8 =1.-smoothstep(0.,gr,length(uv-c8 ));
    float i9 =1.-smoothstep(0.,gr,length(uv-c9 ));
    float i10=1.-smoothstep(0.,gr,length(uv-c10));

    vec2 ru1=uv-.5;float a1=t*uSpd*.15;
    ru1=vec2(ru1.x*cos(a1)-ru1.y*sin(a1),ru1.x*sin(a1)+ru1.y*cos(a1));ru1+=.5;
    vec2 ru2=uv-.5;float a2=-t*uSpd*.12;
    ru2=vec2(ru2.x*cos(a2)-ru2.y*sin(a2),ru2.x*sin(a2)+ru2.y*cos(a2));ru2+=.5;
    float ri1=1.-smoothstep(0.,.8,length(ru1-.5));
    float ri2=1.-smoothstep(0.,.8,length(ru2-.5));

    vec3 col=vec3(0.);
    col+=uC1*i1 *(0.55+0.45*sin(t*uSpd      ))*uW1;
    col+=uC2*i2 *(0.55+0.45*cos(t*uSpd*1.2  ))*uW2;
    col+=uC1*i3 *(0.55+0.45*sin(t*uSpd*.8   ))*uW1;
    col+=uC2*i4 *(0.55+0.45*cos(t*uSpd*1.3  ))*uW2;
    col+=uC1*i5 *(0.55+0.45*sin(t*uSpd*1.1  ))*uW1;
    col+=uC2*i6 *(0.55+0.45*cos(t*uSpd*.9   ))*uW2;
    col+=uC1*i7 *(0.55+0.45*sin(t*uSpd*1.4  ))*uW1;
    col+=uC2*i8 *(0.55+0.45*cos(t*uSpd*1.5  ))*uW2;
    col+=uC1*i9 *(0.55+0.45*sin(t*uSpd*1.6  ))*uW1;
    col+=uC2*i10*(0.55+0.45*cos(t*uSpd*1.7  ))*uW2;
    col+=mix(uC1,uC3,ri1)*.45*uW1;
    col+=mix(uC2,uC4,ri2)*.4 *uW2;

    col=clamp(col,vec3(0.),vec3(1.))*uInt;
    float lum=dot(col,vec3(.299,.587,.114));
    col=mix(vec3(lum),col,1.35);
    col=pow(col,vec3(.92));
    float br=length(col);
    col=mix(uNav,col,max(br*1.2,.15));
    float mb=length(col);if(mb>1.)col*=1./mb;
    return col;
  }

  void main(){
    vec2 uv=vUv;
    vec4 tx=texture2D(uTex,uv);
    float vx=-(tx.r*2.-1.),vy=-(tx.g*2.-1.),it=tx.b;
    uv.x+=vx*.8*it; uv.y+=vy*.8*it;
    float d=length(uv-vec2(.5));
    uv+=vec2(sin(d*20.-uTime*3.)*.04*it+sin(d*15.-uTime*2.)*.03*it);
    vec3 col=getC(uv,uTime);
    col+=grain(uv,uTime)*uGr;
    float ts=uTime*.5;
    col.r+=sin(ts)*.02;col.g+=cos(ts*1.4)*.02;col.b+=sin(ts*1.2)*.02;
    float br=length(col);
    col=mix(uNav,col,max(br*1.2,.15));
    col=clamp(col,vec3(0.),vec3(1.));
    gl_FragColor=vec4(col,1.);
  }
`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function LiquidGradientBg() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tt = new TouchTexture();

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // PerspectiveCamera — matches scheme exactly
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;

    // Scene with dark navy background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e27);

    // Helper: compute plane size from FOV so it fills the screen
    const getViewSize = () => {
      const fov = camera.fov * Math.PI / 180;
      const h   = Math.abs(camera.position.z * Math.tan(fov / 2) * 2);
      return { w: h * camera.aspect, h };
    };

    // Uniforms — Scheme 1: #F15A22 (orange) + #0A0E27 (navy)
    const BU = {
      uTime: { value: 0 },
      uRes:  { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uC1:   { value: new THREE.Vector3(0.945, 0.353, 0.133) }, // #F15A22
      uC2:   { value: new THREE.Vector3(0.039, 0.055, 0.153) }, // #0A0E27
      uC3:   { value: new THREE.Vector3(0.945, 0.353, 0.133) }, // #F15A22
      uC4:   { value: new THREE.Vector3(0.039, 0.055, 0.153) }, // #0A0E27
      uC5:   { value: new THREE.Vector3(0.945, 0.353, 0.133) }, // #F15A22
      uC6:   { value: new THREE.Vector3(0.039, 0.055, 0.153) }, // #0A0E27
      uNav:  { value: new THREE.Vector3(0.039, 0.055, 0.153) }, // #0A0E27 dark base
      uSpd:  { value: 1.5 },
      uInt:  { value: 1.8 },
      uGr:   { value: 0.08 },
      uGS:   { value: 0.45 },
      uW1:   { value: 0.5  },
      uW2:   { value: 1.8  },
      uTex:  { value: tt.tex },
    };

    // Plane sized to exactly fill the camera frustum
    const v = getViewSize();
    const geo = new THREE.PlaneGeometry(v.w, v.h);
    const mat = new THREE.ShaderMaterial({ uniforms: BU, vertexShader: VERT, fragmentShader: FRAG });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // Mouse / touch → distortion
    const onMouseMove = (e) => tt.add({ x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight });
    const onTouch     = (e) => {
      const t = e.touches[0];
      tt.add({ x: t.clientX / window.innerWidth, y: 1 - t.clientY / window.innerHeight });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouch, { passive: true });

    // Resize
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      BU.uRes.value.set(window.innerWidth, window.innerHeight);
      const nv = getViewSize();
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(nv.w, nv.h);
    };
    window.addEventListener('resize', onResize);

    // Render loop
    const clock = new THREE.Clock();
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      BU.uTime.value += Math.min(clock.getDelta(), 0.1);
      tt.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('resize', onResize);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} id="liquid-bg" />;
}
