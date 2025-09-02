const anthem = document.getElementById('anthem');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const seekRange = document.getElementById('seekRange');
const volumeRange = document.getElementById('volumeRange');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');

function requestAudioContextUnlock() {
    // iOS/Safari require a user gesture to start audio
    const unlock = () => {
        const buffer = new (window.AudioContext || window.webkitAudioContext)();
        buffer.resume();
        document.removeEventListener('touchend', unlock);
        document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchend', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// GSAP animation for flag sway & SVG filter modulation
function initFlagAnimation() {
    const svg = document.querySelector('.flag-svg');
    if (!svg || !window.gsap) return;

    gsap.to(svg, { duration: 3, repeat: -1, yoyo: true, ease: 'sine.inOut', x: -3, rotationY: 3, transformPerspective: 600, transformOrigin: 'left center' });

    // Animate turbulence/displacement attributes subtly
    const noiseNode = document.getElementById('noiseNode');
    const dispNode = document.getElementById('dispNode');
    if (noiseNode && dispNode) {
        gsap.to(noiseNode, { attr: { baseFrequency: '0.010 0.023' }, duration: 2.6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        gsap.to(dispNode, { attr: { scale: 10 }, duration: 2.2, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    }
}

playBtn?.addEventListener('click', async () => {
    try {
        requestAudioContextUnlock();
        await anthem.play();
        // Confetti celebration once when play is pressed
        if (window.confetti) {
            const defaults = { spread: 70, ticks: 120, gravity: 0.5, decay: 0.93, startVelocity: 25 };            
            confetti({ ...defaults, particleCount: 80, origin: { x: 0.2, y: 0.2 } });
            confetti({ ...defaults, particleCount: 80, origin: { x: 0.8, y: 0.2 } });
        }
    } catch (err) {
        console.warn('Không thể phát âm thanh tự động. Vui lòng tương tác để phát.', err);
    }
});

pauseBtn?.addEventListener('click', () => {
    anthem.pause();
});

// Tùy chọn: tự động phát sau tương tác đầu tiên với trang
document.addEventListener('DOMContentLoaded', () => {
    const tryAutoPlay = () => {
        anthem.play().catch(() => {});
        document.removeEventListener('click', tryAutoPlay);
        document.removeEventListener('touchend', tryAutoPlay);
    };
    document.addEventListener('click', tryAutoPlay, { once: true });
    document.addEventListener('touchend', tryAutoPlay, { once: true });
    initFlagAnimation();
    initThreeScene();
});

// Duration and time update
anthem.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(anthem.duration);
});

anthem.addEventListener('timeupdate', () => {
    currentTimeEl.textContent = formatTime(anthem.currentTime);
    if (anthem.duration) {
        seekRange.value = (anthem.currentTime / anthem.duration) * 100;
    }
});

seekRange?.addEventListener('input', () => {
    if (!anthem.duration) return;
    const pct = Number(seekRange.value) / 100;
    anthem.currentTime = anthem.duration * pct;
});

// Volume
if (volumeRange) {
    anthem.volume = Number(volumeRange.value);
    volumeRange.addEventListener('input', () => {
        anthem.volume = Number(volumeRange.value);
    });
}

// === Three.js 3D scene ===
let renderer, scene, camera, controls, clock;
let flagMesh;
let fireworkParticles = [];
let marchers = [];
let spotLight, spotTarget, starMesh;
let sloganGroup;

function initThreeScene() {
    if (!window.THREE) return;
    const root = document.getElementById('threeRoot');
    if (!root) return;
    const width = window.innerWidth;
    const height = window.innerHeight;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = 'three-canvas';
    root.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
    camera.position.set(0.8, 0.5, 2.2);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 3.5;
    controls.target.set(0, 0.3, 0);

    clock = new THREE.Clock();

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 6, 3);
    scene.add(dir);

    // Flag geometry (plane) with custom shader for wind
    const widthSeg = 80, heightSeg = 40;
    const geo = new THREE.PlaneGeometry(1.6, 1.06, widthSeg, heightSeg);
    geo.rotateY(Math.PI);

    const vertexShader = `
        varying vec2 vUv;
        uniform float uTime;
        void main(){
            vUv = uv;
            float anchor = smoothstep(0.0, 0.1, uv.x);
            float wave = sin((uv.y * 6.2831 + uTime * 1.8)) * 0.02;
            wave += sin((uv.x * 9.0 + uTime * 1.2)) * 0.02 * (1.0 - anchor);
            vec3 pos = position + normal * wave * (1.0 - anchor) * 1.8;
            pos.z += pow(uv.x, 1.5) * 0.06;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `;

    const fragmentShader = `
        varying vec2 vUv;
        const vec3 RED = vec3(0.854, 0.145, 0.115);
        const vec3 YEL = vec3(1.0, 0.871, 0.0);
        float starSDF(vec2 p, float r, float rf){
            float a = atan(p.y, p.x);
            float n = 5.0;
            float k = 3.14159265/n;
            float m = mod(a, 2.0*k) - k;
            float d = cos(m) * length(p) - r;
            float inner = rf;
            d = max(d, -(length(p) - inner));
            return d;
        }
        void main(){
            vec2 uv = vUv;
            vec2 c = uv - 0.5;
            float vignette = smoothstep(0.9, 0.2, length(c));
            vec3 col = RED * (0.9 + 0.1 * vignette);
            vec2 sp = (uv - vec2(0.5));
            float d = starSDF(sp, 0.16, 0.065);
            float star = smoothstep(0.004, -0.004, d);
            col = mix(col, YEL, star);
            float stripe = smoothstep(0.0, 0.8, abs(sin((uv.y + uv.x*0.2) * 6.2831)));
            col += 0.03 * stripe;
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader, fragmentShader, side: THREE.DoubleSide
    });
    flagMesh = new THREE.Mesh(geo, mat);
    flagMesh.position.set(0.1, 0.6, 0);
    scene.add(flagMesh);

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.6, 16);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9ea3a8, metalness: 0.8, roughness: 0.3 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(-0.78, 0.3, -0.02);
    scene.add(pole);

    // Ground fog plane
    const fogGeo = new THREE.PlaneGeometry(10, 10);
    const fogMat = new THREE.MeshBasicMaterial({ color: 0x0a0f20, opacity: 0.55, transparent: true });
    const fog = new THREE.Mesh(fogGeo, fogMat);
    fog.rotation.x = -Math.PI / 2;
    fog.position.y = -0.4;
    scene.add(fog);

    // Showpieces
    createStarAndSpotlight();
    createParade();
    loadSloganText();

    window.addEventListener('resize', onResize);
    animate();
}

function onResize(){
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function spawnFirework(){
    if (!scene || !THREE) return;
    const geometry = new THREE.BufferGeometry();
    const count = 160;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i*3] = (Math.random()-0.5)*0.2;
        positions[i*3+1] = 0.4 + Math.random()*0.2;
        positions[i*3+2] = (Math.random()-0.5)*0.2;
        const dir = new THREE.Vector3().randomDirection().multiplyScalar(0.8 + Math.random()*0.6);
        velocities[i*3] = dir.x;
        velocities[i*3+1] = dir.y;
        velocities[i*3+2] = dir.z;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    const material = new THREE.PointsMaterial({ color: 0xffde00, size: 0.02, transparent: true, opacity: 1 });
    const points = new THREE.Points(geometry, material);
    points.userData.birth = performance.now();
    scene.add(points);
    fireworkParticles.push(points);
}

let beatTimer = 0;

function animate(){
    requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;
    const t = clock.getDelta();
    if (flagMesh) {
        flagMesh.material.uniforms.uTime.value += t;
    }
    if (!anthem.paused) {
        beatTimer += t;
        const bpm = 88;
        const interval = 60 / bpm;
        if (beatTimer >= interval) {
            beatTimer = 0;
            spawnFirework();
        }
    }

    // Parade marching update
    if (marchers.length) {
        for (const m of marchers) {
            m.position.x += 0.3 * t;
            m.position.y = 0.05 + Math.sin((performance.now() * 0.005) + m.userData.phase) * 0.02;
            m.rotation.z = Math.sin((performance.now() * 0.005) + m.userData.phase) * 0.08;
            if (m.position.x > 1.3) m.position.x = -1.4;
        }
    }
    const g = 1.2;
    for (let i = fireworkParticles.length - 1; i >= 0; i--) {
        const p = fireworkParticles[i];
        const pos = p.geometry.getAttribute('position');
        const vel = p.geometry.getAttribute('velocity');
        for (let j = 0; j < pos.count; j++) {
            vel.array[j*3+1] -= g * t * 0.5;
            pos.array[j*3] += vel.array[j*3] * t;
            pos.array[j*3+1] += vel.array[j*3+1] * t;
            pos.array[j*3+2] += vel.array[j*3+2] * t;
        }
        pos.needsUpdate = true;
        vel.needsUpdate = true;
        const age = (performance.now() - p.userData.birth) / 1000;
        p.material.opacity = Math.max(0, 1 - age * 0.8);
        if (age > 2.2) {
            scene.remove(p);
            fireworkParticles.splice(i, 1);
        }
    }
    controls.update();
    renderer.render(scene, camera);
}

playBtn?.addEventListener('click', () => {
    for (let i = 0; i < 3; i++) setTimeout(spawnFirework, i * 160);
    animateShowpiecesOnPlay();
});

// === Parade ===
function createParade(){
    const group = new THREE.Group();
    const unitGeo = new THREE.BoxGeometry(0.08, 0.14, 0.08);
    const unitMat = new THREE.MeshStandardMaterial({ color: 0xda251d, metalness: 0.2, roughness: 0.6 });
    const capGeo = new THREE.ConeGeometry(0.05, 0.08, 12);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffde00, metalness: 0.4, roughness: 0.5 });
    const count = 14;
    for (let i = 0; i < count; i++) {
        const soldier = new THREE.Group();
        const body = new THREE.Mesh(unitGeo, unitMat);
        body.castShadow = false; body.receiveShadow = false;
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 0.13;
        soldier.add(body);
        soldier.add(cap);
        soldier.position.set(-1.4 - i*0.18, -0.33, -0.4 + (i%2)*0.1);
        soldier.userData.phase = Math.random()*Math.PI*2;
        group.add(soldier);
        marchers.push(soldier);
    }
    scene.add(group);
}

// === Spotlight + Star ===
function createStarAndSpotlight(){
    // a simple 3D star proxy (icosahedron) as golden emblem
    const starGeo = new THREE.IcosahedronGeometry(0.07, 0);
    const starMat = new THREE.MeshStandardMaterial({ color: 0xffde00, metalness: 0.9, roughness: 0.2, emissive: 0x332200, emissiveIntensity: 0.4 });
    starMesh = new THREE.Mesh(starGeo, starMat);
    starMesh.position.set(0.35, 0.9, -0.1);
    scene.add(starMesh);

    spotLight = new THREE.SpotLight(0xfff5a5, 0.0, 8, Math.PI/8, 0.4, 1.2);
    spotLight.position.set(0, 1.4, 1.2);
    spotTarget = new THREE.Object3D();
    spotTarget.position.copy(starMesh.position);
    scene.add(spotTarget);
    spotLight.target = spotTarget;
    scene.add(spotLight);

    if (window.gsap) {
        gsap.to(spotLight, { intensity: 1.2, duration: 2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        gsap.to(spotLight.position, { x: 0.6, duration: 4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
}

// === 3D Text ===
function loadSloganText(){
    if (!THREE || !THREE.FontLoader) return;
    const loader = new THREE.FontLoader();
    loader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', (font) => {
        const textGeo = new THREE.TextGeometry('Độc lập – Tự do – Hạnh phúc', {
            font, size: 0.09, height: 0.02, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2
        });
        textGeo.center();
        const textMat = new THREE.MeshStandardMaterial({ color: 0xffde00, metalness: 0.6, roughness: 0.35, emissive: 0x221100, emissiveIntensity: 0.25 });
        const mesh = new THREE.Mesh(textGeo, textMat);
        sloganGroup = new THREE.Group();
        sloganGroup.add(mesh);
        sloganGroup.position.set(0, -0.9, 0);
        sloganGroup.scale.set(0.8, 0.8, 0.8);
        scene.add(sloganGroup);
    });
}

function animateShowpiecesOnPlay(){
    if (!window.gsap) return;
    if (sloganGroup) {
        sloganGroup.position.y = -0.9;
        sloganGroup.rotation.x = -0.2;
        gsap.to(sloganGroup.position, { y: -0.05, duration: 2.2, ease: 'expo.out' });
        gsap.fromTo(sloganGroup.rotation, { x: -0.3 }, { x: 0.0, duration: 1.6, ease: 'sine.out' });
        gsap.fromTo(sloganGroup.scale, { x: 0.6, y: 0.6, z: 0.6 }, { x: 1.0, y: 1.0, z: 1.0, duration: 2, ease: 'expo.out' });
    }
    if (spotLight) {
        gsap.to(spotLight, { intensity: 2.0, duration: 1.2, yoyo: true, repeat: 1, ease: 'power2.inOut' });
    }
}
