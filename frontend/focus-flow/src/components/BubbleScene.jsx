import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Renders the Tinky (purple blob) GLTF character with bubbles and particles.
 * Transparent background — no scene.background set.
 * Loads model from: https://stivs-assets.s3.us-east-2.amazonaws.com/mrp/model.gltf
 */
export default function BubbleScene() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth  || 200;
    const H = mount.clientHeight || 200;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2;
    // No renderer.setClearColor → stays transparent
    mount.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    // NOTE: do NOT set scene.background (user wants no bg)

    const camera = new THREE.PerspectiveCamera(60, W / H, 1, 10000);
    camera.position.set(0, -10, 500);

    // Lights
    scene.add(new THREE.AmbientLight(0xaa54f0, 1));
    const d1 = new THREE.DirectionalLight(0xffffff, 1);
    d1.position.set(-2, 2, 5);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xfff000, 1);
    d2.position.set(-2, 4, 4);
    scene.add(d2);

    // Particles
    const pGeo = new THREE.BufferGeometry();
    const count = 300;
    const positions = new Float32Array(count * 3);
    const colors    = new Float32Array(count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      col.setHSL(Math.random(), 1, 0.5);
      positions[i * 3]     = (Math.random() - 0.5) * 800;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 800;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 800;
      colors[i * 3]     = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3, true));
    const pMat = new THREE.PointsMaterial({
      size: 10,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // Bubble material helper (semi-transparent physical sphere)
    const makeBubbleMat = () => new THREE.MeshPhysicalMaterial({
      color: 0x21024f,
      metalness: 0,
      roughness: 0,
      depthWrite: false,
      transmission: 0.9,
      opacity: 1,
      transparent: true,
      side: THREE.BackSide,
    });

    // Static background bubbles
    const bGeo1 = new THREE.SphereGeometry(170, 32, 32);
    const bGeo2 = new THREE.SphereGeometry(55, 32, 32);
    const bGeo3 = new THREE.SphereGeometry(30, 32, 32);
    const bGeo4 = new THREE.SphereGeometry(70, 32, 32);

    const b1 = new THREE.Mesh(bGeo1, makeBubbleMat()); b1.position.z = 15;
    const b2 = new THREE.Mesh(bGeo2, makeBubbleMat()); b2.position.set(-175, -135, 75);
    const b3 = new THREE.Mesh(bGeo3, makeBubbleMat()); b3.position.set(137, -136, 50);
    const b4 = new THREE.Mesh(bGeo4, makeBubbleMat()); b4.position.set(210, 100, 70);
    scene.add(b1, b2, b3, b4);

    // Floating small bubbles
    const smallGeo  = new THREE.SphereGeometry(10, 32, 32);
    const spheres   = [];

    const spawnBubble = () => {
      if (spheres.length > 15) return;
      const m = new THREE.Mesh(smallGeo, makeBubbleMat());
      m.position.set(
        (Math.random() - 0.5) * 700,
        (Math.random() - 0.5) * 700,
        (Math.random() - 0.5) * 700,
      );
      const s = Math.random() * 3 + 1;
      m.scale.setScalar(s);
      m.randomness = Math.random() * 50;
      spheres.push(m);
      scene.add(m);
    };
    const spawnInterval = setInterval(spawnBubble, 2000);

    // Try loading the GLTF model
    let tinky = null;
    let modelLoaded = false;
    const loadModel = async () => {
      try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const { RGBELoader  } = await import('three/addons/loaders/RGBELoader.js');
        const pmrem = new THREE.PMREMGenerator(renderer);

        const hdr = await new Promise((res, rej) =>
          new RGBELoader()
            .setDataType(THREE.HalfFloatType)
            .load('https://stivs-assets.s3.us-east-2.amazonaws.com/mrp/env.hdr', res, undefined, rej)
        );
        const envMap = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose(); pmrem.dispose();

        await new Promise((res, rej) =>
          new GLTFLoader().load(
            'https://stivs-assets.s3.us-east-2.amazonaws.com/mrp/model.gltf',
            (gltf) => {
              tinky = gltf.scene;
              tinky.scale.setScalar(80);
              tinky.castShadow = true;
              scene.add(tinky);

              const meshes = {};
              tinky.children.forEach(el => { el.receiveShadow = true; meshes[el.name] = el; });

              // Position child elements
              if (meshes.bigStar)   { meshes.bigStar.position.set(-2.2, -1.7, 0.8);   meshes.bigStar.rotation.z   = -0.5; }
              if (meshes.littleStar){ meshes.littleStar.position.set(1.75,-1.75,0.6); meshes.littleStar.rotation.z = 0.5; }
              if (meshes.planet)    { meshes.planet.position.set(2.6, 1.3, 1); }
              if (meshes.ClosedLeftEye)  meshes.ClosedLeftEye.visible  = false;
              if (meshes.ClosedRightEye) meshes.ClosedRightEye.visible = false;

              // Apply env map to all bubbles
              [b1,b2,b3,b4].forEach(b => { b.material.envMap = envMap; b.material.envMapIntensity = 10; b.material.needsUpdate = true; });

              modelLoaded = true;
              res();
            },
            undefined,
            rej
          )
        );
      } catch {
        // Model load failed silently — bubbles + particles still render
      }
    };
    loadModel();

    const clock = new THREE.Clock();
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const tMs = Math.round(t * 1000);

      particles.rotation.y = t * 0.02;

      spheres.forEach(s => {
        const speed = 0.02 + 0.01 * s.randomness;
        const h = t * speed + s.randomness;
        const th = t * -speed + s.randomness * 0.5;
        const R = 350;
        s.position.x = R * Math.cos(th) * Math.sin(h);
        s.position.y = R * Math.sin(th) * Math.sin(h);
        s.position.z = R * Math.cos(h);
      });

      if (modelLoaded && tinky) {
        const meshes = {};
        tinky.children.forEach(el => { meshes[el.name] = el; });
        if (meshes.planet)    { meshes.planet.rotation.y += 0.002; meshes.planet.rotation.z += 0.002; }
        const blink = tMs % 3000 > 2750;
        if (meshes.RightEye)       meshes.RightEye.visible       = !blink;
        if (meshes.LeftEye)        meshes.LeftEye.visible        = !blink;
        if (meshes.ClosedRightEye) meshes.ClosedRightEye.visible =  blink;
        if (meshes.ClosedLeftEye)  meshes.ClosedLeftEye.visible  =  blink;
      }

      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(spawnInterval);
      window.removeEventListener('resize', onResize);
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} className="bubble-container" />;
}
