import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// TouchTexture: tracks mouse trail and converts to texture
class TouchTexture {
  constructor() {
    this.size = 64;
    this.maxAge = 64;
    this.radius = 0.25 * this.size;
    this.trail = [];
    this.last = null;
    this._init();
  }

  _init() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.texture = new THREE.CanvasTexture(this.canvas);
  }

  update() {
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.size, this.size);
    const speed = 1 / this.maxAge;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      const f = p.force * speed * (1 - p.age / this.maxAge);
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.age++;
      if (p.age > this.maxAge) { this.trail.splice(i, 1); continue; }
      this._drawPoint(p);
    }
    this.texture.needsUpdate = true;
  }

  addTouch(point) {
    let force = 0, vx = 0, vy = 0;
    if (this.last) {
      const dx = point.x - this.last.x;
      const dy = point.y - this.last.y;
      if (dx === 0 && dy === 0) return;
      const d = Math.sqrt(dx * dx + dy * dy);
      vx = dx / d; vy = dy / d;
      force = Math.min((dx * dx + dy * dy) * 20000, 2.0);
    }
    this.last = { x: point.x, y: point.y };
    this.trail.push({ x: point.x, y: point.y, age: 0, force, vx, vy });
  }

  _drawPoint(p) {
    const pos = { x: p.x * this.size, y: (1 - p.y) * this.size };
    let intensity = p.age < this.maxAge * 0.3
      ? Math.sin((p.age / (this.maxAge * 0.3)) * (Math.PI / 2))
      : -(1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)) * ((1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)) - 2);
    intensity *= p.force;
    const r = this.radius;
    const color = `${((p.vx + 1) / 2) * 255},${((p.vy + 1) / 2) * 255},${intensity * 255}`;
    const offset = this.size * 5;
    this.ctx.shadowOffsetX = offset;
    this.ctx.shadowOffsetY = offset;
    this.ctx.shadowBlur = r;
    this.ctx.shadowColor = `rgba(${color},${0.2 * intensity})`;
    this.ctx.beginPath();
    this.ctx.fillStyle = 'rgba(255,0,0,1)';
    this.ctx.arc(pos.x - offset, pos.y - offset, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  reset() { this.last = null; }
}

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vUv = uv;
}
`;

const FRAGMENT_SHADER = `
uniform float uTime;
uniform vec2  uResolution;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform float uSpeed;
uniform sampler2D uTouchTexture;
uniform float uGrainIntensity;
varying vec2 vUv;
#define PI 3.14159265359

float grain(vec2 uv, float t) {
  vec2 g = uv * uResolution * 0.5;
  return fract(sin(dot(g + t, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
}

void main() {
  float t = uTime * uSpeed;

  // Mouse distortion
  vec4 touch = texture2D(uTouchTexture, vUv);
  vec2 distort = (touch.rg * 2.0 - 1.0) * touch.b * 0.08;
  vec2 uv = vUv + distort;

  // Animated gradient centers
  vec2 c1 = vec2(0.5 + sin(t * 0.4) * 0.42, 0.5 + cos(t * 0.5) * 0.42);
  vec2 c2 = vec2(0.5 + cos(t * 0.6) * 0.48, 0.5 + sin(t * 0.45) * 0.48);
  vec2 c3 = vec2(0.5 + sin(t * 0.35) * 0.4,  0.5 + cos(t * 0.55) * 0.44);
  vec2 c4 = vec2(0.5 + cos(t * 0.5)  * 0.38, 0.5 + sin(t * 0.4)  * 0.38);
  vec2 c5 = vec2(0.5 + sin(t * 0.7)  * 0.34, 0.5 + cos(t * 0.6)  * 0.36);
  vec2 c6 = vec2(0.5 + cos(t * 0.45) * 0.46, 0.5 + sin(t * 0.65) * 0.46);

  float r = 0.85; // gradient radius
  float i1 = 1.0 - smoothstep(0.0, r, length(uv - c1));
  float i2 = 1.0 - smoothstep(0.0, r, length(uv - c2));
  float i3 = 1.0 - smoothstep(0.0, r, length(uv - c3));
  float i4 = 1.0 - smoothstep(0.0, r, length(uv - c4));
  float i5 = 1.0 - smoothstep(0.0, r, length(uv - c5));
  float i6 = 1.0 - smoothstep(0.0, r, length(uv - c6));

  vec3 color = vec3(0.0);
  color += uColor1 * i1 * (0.55 + 0.45 * sin(t));
  color += uColor2 * i2 * (0.55 + 0.45 * cos(t * 1.2));
  color += uColor3 * i3 * (0.55 + 0.45 * sin(t * 0.8));
  color += uColor4 * i4 * (0.55 + 0.45 * cos(t * 1.3));
  color += uColor1 * i5 * (0.55 + 0.45 * sin(t * 1.1));
  color += uColor2 * i6 * (0.55 + 0.45 * cos(t * 0.9));

  // Dark navy base
  vec3 base = vec3(0.039, 0.055, 0.153);
  float totalI = max(i1 + i2 + i3 + i4 + i5 + i6, 0.001);
  color = mix(base, color / totalI * 0.9, clamp(totalI, 0.0, 1.0));

  // Film grain
  color += grain(uv, uTime) * uGrainIntensity;

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function LiquidGradientBg() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = new TouchTexture();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    camera.position.z = 1;

    const uniforms = {
      uTime:         { value: 0 },
      uResolution:   { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uColor1:       { value: new THREE.Vector3(0.945, 0.310, 0.129) }, // #F14F21 orange
      uColor2:       { value: new THREE.Vector3(0.039, 0.055, 0.153) }, // #0A0E27 navy
      uColor3:       { value: new THREE.Vector3(0.945, 0.310, 0.129) },
      uColor4:       { value: new THREE.Vector3(0.039, 0.055, 0.153) },
      uSpeed:        { value: 1.2 },
      uTouchTexture: { value: touch.texture },
      uGrainIntensity: { value: 0.06 },
    };

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const onMouseMove = (e) => {
      touch.addTouch({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener('mousemove', onMouseMove);

    let raf;
    const clock = new THREE.Clock();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      uniforms.uTime.value = clock.getElapsedTime();
      touch.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} id="liquid-bg" />;
}
