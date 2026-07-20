import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';

export default function Button3D({ children, onClick }) {
  const mountRef  = useRef(null);  // where Three.js canvas is appended
  const btnRef    = useRef(null);  // the actual button element
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    const btn   = btnRef.current;
    if (!mount || !btn) return;

    const W = 300, H = 220;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, W / H, 1, 3000);
    camera.position.z = 200;

    const mouse = { x: 0, y: 0 };

    // Lights
    scene.add(new THREE.AmbientLight(0x0085ff));
    // 環境光，非常暗的灰色，讓整個場景有最低限度的底色光，避免完全黑暗的地方變成死黑。
    const spot = new THREE.SpotLight(0xff6969, 0.5, 0);
    // 聚光燈，粉紅/玫瑰色，強度 0.8，從座標 (150, 150, 0) 打過來，像舞台聚光燈，會製造明顯的光影效果。
    spot.position.set(150, 150, 0);
    scene.add(spot);
    scene.add(new THREE.HemisphereLight(0xffbe00,0x4e0099, 1.2));
    // 半球光，上方是淡紫色、下方是亮藍色（React 的藍），強度 1.2，模擬天空+地面的自然環境光，讓物體看起來更有立體感。

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xf8a790,
      roughness: 0.25,
      // 	0 = 完美鏡面，1 = 全霧面
      metalness: 0.15,
      // 	0 = 非金屬，1 = 完全金屬
      transparent: true,
      opacity: 0.92,
    });

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(22, 32, 32), mat);
    sphere.position.set(-25, -30, 0);
    scene.add(sphere);

    const torusMat = mat.clone();
    torusMat.opacity = 0;
    const torus = new THREE.Mesh(new THREE.TorusGeometry(15, 7, 16, 100), torusMat);
    torus.position.set(30, 30, 0);
    torus.rotation.set(2.3, 0.3, 0);
    scene.add(torus);

    const coneMat = mat.clone();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 15, 32), coneMat);
    cone.position.set(-50, 12, 3);
    cone.rotation.set(-0.3, 0, 0.7);
    scene.add(cone);

    const animIn = () => {
      gsap.to(torusMat,       { opacity: 1, duration: 0.6 });
      gsap.fromTo(torus.scale,    { x:.8,y:.8,z:.8 }, { x:1.35,y:1.35,z:1.35, duration:.6 });
      gsap.fromTo(torus.position, { x:10,y:20 },      { x:30,y:40, duration:.6 });
      gsap.fromTo(torus.rotation, { x:2.0,y:-.3 },    { x:2.3,y:.3, duration:.6 });
      gsap.fromTo(sphere.scale,   { x:.8,y:.8,z:.8 }, { x:1.15,y:1.15,z:1.15, duration:.6 });
      gsap.fromTo(sphere.position,{ x:-10,y:-10 },    { x:-30,y:-40, duration:.6 });
      gsap.fromTo(cone.scale,     { x:.8,y:.8,z:.8 }, { x:1.35,y:1.35,z:1.35, duration:.6 });
      gsap.fromTo(cone.position,  { x:-30,y:2,z:3 },  { x:-100,y:12,z:3, duration:.6 });
      gsap.fromTo(cone.rotation,  { x:-.2,z:0 },      { x:-.3,z:.7, duration:.6 });
    };

    const animOut = () => {
      gsap.to(torusMat,       { opacity: 0, duration: 0.6 });
      gsap.to(torus.scale,    { x:.8,y:.8,z:.8, duration:.6 });
      gsap.to(torus.position, { x:10,y:20, duration:.6 });
      gsap.to(torus.rotation, { x:2.0,y:-.3, duration:.6 });
      gsap.to(sphere.scale,   { x:.8,y:.8,z:.8, duration:.6 });
      gsap.to(sphere.position,{ x:-10,y:-10, duration:.6 });
      gsap.to(cone.scale,     { x:.8,y:.8,z:.8, duration:.6 });
      gsap.to(cone.position,  { x:-30,y:2,z:3, duration:.6 });
      gsap.to(cone.rotation,  { x:-.2,z:0, duration:.6 });
    };

    const onEnter = () => { setHovered(true);  animIn();  };
    const onLeave = () => { setHovered(false); animOut(); };
    btn.addEventListener('mouseenter', onEnter);
    btn.addEventListener('mouseleave', onLeave);

    const onMove = (e) => {
      mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMove);

    let raf;
    let then = Date.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      if (now - then < 1000 / 60) return;
      then = now;
      camera.position.x += mouse.x * (window.innerWidth  * 0.012) - camera.position.x * 0.03;
      camera.position.y += -(mouse.y * (window.innerHeight * 0.012)) - camera.position.y * 0.03;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      btn.removeEventListener('mouseenter', onEnter);
      btn.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('mousemove', onMove);
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="btn-3d-wrapper">
      {/* Three.js canvas sits behind the button */}
      <div
        ref={mountRef}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 4,
          width: 300,
          height: 220,
        }}
      />
      <button ref={btnRef} className={`btn-3d${hovered ? ' hovered' : ''}`} onClick={onClick}>
        <span>{children}</span>
      </button>
    </div>
  );
}
