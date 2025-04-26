//import the three.js libraries and the PointerLockControls
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
let world, view, display, playerControls;
let timer = new THREE.Clock();
let boatObject, fishObject, buoyObject; 
let groundMesh;
let goForward = false;
let goBackward = false;
let goLeft = false;
let goRight = false;
const speedVector = new THREE.Vector3();
const movementDirection = new THREE.Vector3();
const playerSpeed = 40.0;

const smokeEmitters = [];
const obstacles = [];
const viewHeight = 5; 

let overheadView, usingOverheadView = false;

//shader for the Particle fumes
const smokeVertexShaderCode = `
    uniform float elapsedTime; // Renamed from 'time'
    varying vec3 vPosition;
    void main() {
        vPosition = position;
        vec3 transformed = position;
        transformed.y += sin(position.x * 2.0 + elapsedTime) * 0.5;
        transformed.y += sin(position.z * 2.0 + elapsedTime) * 0.5;
        transformed.y += elapsedTime * 0.5; // Simulate upward movement
        gl_PointSize = 5.0; // Size of the particle
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
`;

const smokeFragmentShaderCode = `
    varying vec3 vPosition;
    void main() {
        float alpha = 1.0 - length(gl_PointCoord - vec2(0.5)) * 2.0; // Circular fade
        if (alpha < 0.0) discard; // Discard pixels outside the circle
        gl_FragColor = vec4(0.5, 0.2, 1.0, alpha); // Purple-like fume with transparency
    }
`;

// Functions initialization
function setupScene() {
    // Set up the scene
    world = new THREE.Scene();
    world.background = new THREE.Color(0x87CEEB);
    world.fog = new THREE.Fog(0x87CEEB, 100, 500);

    // Set up the camera
    view = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    view.position.set(0, 15, 50);

    // Set up the renderer
    display = new THREE.WebGLRenderer({ antialias: true });
    display.setSize(window.innerWidth, window.innerHeight);
    display.setPixelRatio(window.devicePixelRatio);
    display.shadowMap.enabled = true;
    display.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(display.domElement);

    // Loighiting used in the scene
    const globalLight = new THREE.AmbientLight(0xffffff, 0.6);
    world.add(globalLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(50, 100, 75);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -150;
    sunLight.shadow.camera.right = 150;
    sunLight.shadow.camera.top = 150;
    sunLight.shadow.camera.bottom = -150;
    world.add(sunLight);

    const localLight = new THREE.PointLight(0xffaa00, 1, 100);
    localLight.position.set(0, 50, 0);
    world.add(localLight);

    //Controls in the scene
    playerControls = new PointerLockControls(view, document.body);

    const startInstructions = document.getElementById('instructions');
    if (startInstructions) {
        startInstructions.addEventListener('click', () => {
            playerControls.lock();
            startInstructions.classList.add('hidden');
        });
        //Event listener for when the controls are unlocked
        playerControls.addEventListener('unlock', () => {
            startInstructions.classList.remove('hidden');
        });
    } else {
        console.warn("Instructions element not found!"); 
    }

    //Event listeners for the movement
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Create the scene elements
    makeGround();
    makePath();
    makeWaterSurface();
    addScenery();
    addSmokePots();
    addSkyBackground();

    // Handle the window resizing
    window.addEventListener('resize', handleResize);

    // Start the animation loop
    updateFrame();

    // Initialize top-down camera and button
    setupOverheadView();
    addOverheadViewButton();
}

// Functions to calculate the terrain height
function getHeightAtPoint(x, z) {
    const dist = Math.sqrt(x * x + z * z);
    return Math.max(0, 15 - dist * 0.15);
}

//The island geometry is created here
function makeGround() {
    const groundGeometry = new THREE.PlaneGeometry(200, 200, 50, 50);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x228B22,
        roughness: 0.9,
        metalness: 0.1,
    });
    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = 0;
    groundMesh.receiveShadow = true;
    world.add(groundMesh);

    const vertexPositions = groundGeometry.getAttribute('position');
    for (let i = 0; i < vertexPositions.count; i++) {
        const x = vertexPositions.getX(i);
        const y = vertexPositions.getY(i); 
        const dist = Math.sqrt(x * x + y * y);
        const h = Math.max(0, 15 - dist * 0.15) + (Math.random() * 1.5 - 0.75);
        vertexPositions.setZ(i, h); 
    }
    vertexPositions.needsUpdate = true;
    groundGeometry.computeVertexNormals();
}

// The Gravel Path thats layed accross the scene
function makePath() {
    const curvePoints = [
        new THREE.Vector3(0, 0, 40),
        new THREE.Vector3(-10, 0, 10),
        new THREE.Vector3(-5, 0, -20),
        new THREE.Vector3(20, 0, -40),
        new THREE.Vector3(50, 0, -10),
        new THREE.Vector3(40, 0, 30),
        new THREE.Vector3(10, 0, 45),
        new THREE.Vector3(0, 0, 40)
    ];

    const walkwayCurve = new THREE.CatmullRomCurve3(curvePoints);
    const walkwayWidth = 3;
    const curveSegments = 200;
    const walkwayHeightOffset = 0.1;

    const curvePointsData = walkwayCurve.getPoints(curveSegments);
    const vertexData = [];
    const uvData = [];
    const indexData = [];

    for (let i = 0; i <= curveSegments; i++) {
        const currentPoint = curvePointsData[i];
        const curveTangent = walkwayCurve.getTangentAt(i / curveSegments).normalize();

        const curveNormal = new THREE.Vector3(curveTangent.z, 0, -curveTangent.x).normalize();

        const groundY = getHeightAtPoint(currentPoint.x, currentPoint.z) + walkwayHeightOffset;

        const vertexLeft = new THREE.Vector3()
            .copy(currentPoint)
            .add(curveNormal.clone().multiplyScalar(-walkwayWidth / 2));
        vertexLeft.y = groundY;

        const vertexRight = new THREE.Vector3()
            .copy(currentPoint)
            .add(curveNormal.clone().multiplyScalar(walkwayWidth / 2));
        vertexRight.y = groundY;

        vertexData.push(vertexLeft.x, vertexLeft.y, vertexLeft.z);
        vertexData.push(vertexRight.x, vertexRight.y, vertexRight.z);

        uvData.push(i / curveSegments, 0);
        uvData.push(i / curveSegments, 1);

        if (i < curveSegments) {
            const index = i * 2;
            indexData.push(index, index + 1, index + 2);
            indexData.push(index + 1, index + 3, index + 2);
        }
    }

    const walkwayGeometry = new THREE.BufferGeometry();
    walkwayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertexData, 3));
    walkwayGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvData, 2));
    walkwayGeometry.setIndex(indexData);
    walkwayGeometry.computeVertexNormals();

    const walkwayMaterial = new THREE.MeshStandardMaterial({
        color: 0xAAAAAA,
        roughness: 0.9,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    const walkwayMesh = new THREE.Mesh(walkwayGeometry, walkwayMaterial);
    walkwayMesh.receiveShadow = true;
    world.add(walkwayMesh);
}

//Skybox
function addSkyBackground() {
    const skyTextureLoader = new THREE.CubeTextureLoader();
    const skyTexture = skyTextureLoader.load([
        './textures/skybox_px.jpg', 
        './textures/skybox_nx.jpg', 
        './textures/skybox_py.jpg', 
        './textures/skybox_ny.jpg', 
        './textures/skybox_pz.jpg', 
        './textures/skybox_nz.jpg', 
    ]);
    world.background = skyTexture;
}

//Water surface
function makeWaterSurface() {
    const waterSurfaceGeometry = new THREE.PlaneGeometry(1000, 1000);
    const waterSurfaceMaterial = new THREE.MeshStandardMaterial({
        color: 0x0077be,
        transparent: true,
        opacity: 0.85,
        roughness: 0.1,
        metalness: 0.3,
    });
    const waterSurfaceMesh = new THREE.Mesh(waterSurfaceGeometry, waterSurfaceMaterial);
    waterSurfaceMesh.rotation.x = -Math.PI / 2;
    waterSurfaceMesh.position.y = -1;
    waterSurfaceMesh.receiveShadow = true;
    world.add(waterSurfaceMesh);


    // Adding The Buoys on the water (objects in the water)
    const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const markerGeometry = new THREE.CylinderGeometry(1, 1, 3, 16);

    const markerPositions = [
        { x: 100, z: 100 },
        { x: -100, z: 100 },
        { x: 100, z: -100 },
        { x: -100, z: -100 },
        { x: 0, z: 150 },
    ];

    markerPositions.forEach((positionData, index) => {
        const markerMesh = new THREE.Mesh(markerGeometry, markerMaterial);
        markerMesh.position.set(positionData.x, 0.5, positionData.z); // positions of the buoys above the water level
        markerMesh.castShadow = true;
        world.add(markerMesh);

        console.log(`Buoy ${index + 1} added at position (${positionData.x}, ${positionData.z})`); 
    });

}

// Creation of the objects in the scene
function addScenery() {
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x006400 });

    const cabinX = 0;
    const cabinZ = -30;
    const cabinClearRadius = 15; //radius arouund the hut

    for (let i = 0; i < 50; i++) {
        const treeHeight = Math.random() * 10 + 5;
        const treeRadius = Math.random() * 0.5 + 0.5;
        const treeTrunkGeometry = new THREE.CylinderGeometry(treeRadius * 0.7, treeRadius, treeHeight, 8);
        const treeTrunkMesh = new THREE.Mesh(treeTrunkGeometry, woodMaterial);
        treeTrunkMesh.castShadow = true;
        treeTrunkMesh.receiveShadow = true;

        const canopyRadius = treeRadius * 3 + Math.random() * 2;
        const canopyGeometry = new THREE.SphereGeometry(canopyRadius, 8, 6);
        const canopyMesh = new THREE.Mesh(canopyGeometry, leafMaterial);
        canopyMesh.position.y = treeHeight / 2 + canopyRadius * 0.6;
        canopyMesh.castShadow = true;
        canopyMesh.receiveShadow = true;

        const treeGroup = new THREE.Group();
        treeGroup.add(treeTrunkMesh);
        treeGroup.add(canopyMesh);

        let itemX, itemZ, distanceToCabin;
        do {
            const randomAngle = Math.random() * Math.PI * 2;
            const randomRadius = Math.random() * 70 + 20;
            itemX = Math.cos(randomAngle) * randomRadius;
            itemZ = Math.sin(randomAngle) * randomRadius;
            distanceToCabin = Math.sqrt((itemX - cabinX) ** 2 + (itemZ - cabinZ) ** 2);
        } while (distanceToCabin < cabinClearRadius); // Ensure the tree is outside the hut's radius

        const groundHeight = getHeightAtPoint(itemX, itemZ);

        treeGroup.position.set(itemX, groundHeight + treeHeight / 2, itemZ);
        world.add(treeGroup);

        treeTrunkMesh.updateMatrixWorld();
        const trunkBounds = new THREE.Box3().setFromObject(treeTrunkMesh);
        obstacles.push(trunkBounds);

        canopyMesh.updateMatrixWorld();
        const canopyBounds = new THREE.Box3().setFromObject(canopyMesh);
        obstacles.push(canopyBounds);
    }

    const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8 });
    for (let i = 0; i < 15; i++) {
        const stoneSize = Math.random() * 4 + 2;
        const stoneGeometry = new THREE.IcosahedronGeometry(stoneSize, 0);
        const stoneMesh = new THREE.Mesh(stoneGeometry, stoneMaterial);
        stoneMesh.castShadow = true;
        stoneMesh.receiveShadow = true;

        const randomAngle = Math.random() * Math.PI * 2;
        const randomRadius = Math.random() * 80 + 10;
        const itemX = Math.cos(randomAngle) * randomRadius;
        const itemZ = Math.sin(randomAngle) * randomRadius;
        const groundHeight = getHeightAtPoint(itemX, itemZ);

        stoneMesh.position.set(itemX, groundHeight + stoneSize * 0.5, itemZ);
        stoneMesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        world.add(stoneMesh);

        stoneMesh.updateMatrixWorld();
        const stoneBounds = new THREE.Box3().setFromObject(stoneMesh);
        obstacles.push(stoneBounds);
    }

    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xD2B48C });
    const cabinGeometry = new THREE.BoxGeometry(10, 8, 12);
    const cabinMesh = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabinMesh.castShadow = true;
    cabinMesh.receiveShadow = true;
    const groundHeightCabin = getHeightAtPoint(cabinX, cabinZ);
    cabinMesh.position.set(cabinX, groundHeightCabin + 4, cabinZ);
    world.add(cabinMesh);

    cabinMesh.updateMatrixWorld();
    const cabinBounds = new THREE.Box3().setFromObject(cabinMesh);
    obstacles.push(cabinBounds);


}

// Magical pots that emmit fumes
function addSmokePots() {
    const cauldronMaterial = new THREE.MeshStandardMaterial({ color: 0x8B0000 });
    const cauldronGeometry = new THREE.CylinderGeometry(2, 3, 4, 16);

    for (let i = 0; i < 5; i++) {
        const cauldronMesh = new THREE.Mesh(cauldronGeometry, cauldronMaterial);
        cauldronMesh.castShadow = true;
        cauldronMesh.receiveShadow = true;

        const randomAngle = Math.random() * Math.PI * 2;
        const randomRadius = Math.random() * 50 + 20;
        const itemX = Math.cos(randomAngle) * randomRadius;
        const itemZ = Math.sin(randomAngle) * randomRadius;
        const groundHeight = getHeightAtPoint(itemX, itemZ);

        cauldronMesh.position.set(itemX, groundHeight + 2, itemZ);
        world.add(cauldronMesh);

        cauldronMesh.updateMatrixWorld();
        const cauldronBounds = new THREE.Box3().setFromObject(cauldronMesh);
        obstacles.push(cauldronBounds);

        // Particle system for magical fumes
        const smokeParticleCount = 500;
        const smokeGeometry = new THREE.BufferGeometry();
        const smokePositions = new Float32Array(smokeParticleCount * 3);

        for (let j = 0; j < smokeParticleCount; j++) {
            smokePositions[j * 3] = Math.random() * 2 - 1; 
            smokePositions[j * 3 + 1] = Math.random() * 2 - 1; 
            smokePositions[j * 3 + 2] = Math.random() * 2 - 1; 
        }

        smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));

        const smokeMaterial = new THREE.ShaderMaterial({
            vertexShader: smokeVertexShaderCode,
            fragmentShader: smokeFragmentShaderCode,
            uniforms: {
                elapsedTime: { value: 0 } 
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const smokePoints = new THREE.Points(smokeGeometry, smokeMaterial);
        smokePoints.position.set(itemX, groundHeight + 5, itemZ); 
        world.add(smokePoints);

        smokeEmitters.push({ smokePoints, smokeMat: smokeMaterial }); 
    }
}


// Scene to be respionsive to the window size
function handleResize() {
    view.aspect = window.innerWidth / window.innerHeight;
    view.updateProjectionMatrix();
    display.setSize(window.innerWidth, window.innerHeight);
}

// Keyboard controls
function handleKeyDown(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            goForward = true;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            goLeft = true;
            break;
        case 'ArrowDown':
        case 'KeyS':
            goBackward = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            goRight = true;
            break;
    }
}

function handleKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            goForward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            goLeft = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            goBackward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            goRight = false;
            break;
    }
}

// Animation loop
function updateFrame() {
    requestAnimationFrame(updateFrame);

    const deltaTime = timer.getDelta();
    const elapsedTime = timer.getElapsedTime();

    if (!usingOverheadView && playerControls.isLocked === true) {
        speedVector.x -= speedVector.x * 10.0 * deltaTime;
        speedVector.z -= speedVector.z * 10.0 * deltaTime;

        movementDirection.z = Number(goForward) - Number(goBackward);
        movementDirection.x = Number(goRight) - Number(goLeft);
        movementDirection.normalize();

        if (goForward || goBackward) speedVector.z -= movementDirection.z * playerSpeed * deltaTime;
        if (goLeft || goRight) speedVector.x -= movementDirection.x * playerSpeed * deltaTime;

        const previousPosition = playerControls.getObject().position.clone();

        playerControls.moveRight(-speedVector.x * deltaTime);
        playerControls.moveForward(-speedVector.z * deltaTime);

        const playerPosition = playerControls.getObject().position;
        const playerBounds = new THREE.Sphere(playerPosition, 0.5); 

        let hitObstacle = false;
        for (const obstacleBounds of obstacles) { 
            if (obstacleBounds.intersectsSphere(playerBounds)) {
                hitObstacle = true;
                break;
            }
        }

        if (hitObstacle) {
            playerControls.getObject().position.copy(previousPosition);
            speedVector.x = 0;
            speedVector.z = 0;
        } else {
            const groundHeightPlayer = getHeightAtPoint(playerPosition.x, playerPosition.z);
            playerPosition.y = groundHeightPlayer + viewHeight; 
        }
    }
    updateSmokeEffects(deltaTime, elapsedTime); 

    display.render(world, view);
}

// upading the magical fumes
function updateSmokeEffects(deltaTime, elapsedTime) { 
    smokeEmitters.forEach(({ smokePoints, smokeMat }) => { 
        smokeMat.uniforms.elapsedTime.value = elapsedTime; 
        smokePoints.rotation.y += deltaTime * 0.5;
    });
}

// Top down camera button
function addOverheadViewButton() {
    const viewButton = document.createElement('button'); 
    viewButton.textContent = 'Top-Down View';
    viewButton.style.position = 'fixed';
    viewButton.style.top = '10px';
    viewButton.style.right = '10px';
    viewButton.style.padding = '10px 20px';
    viewButton.style.fontSize = '16px';
    viewButton.style.cursor = 'pointer';
    viewButton.style.zIndex = '20';
    viewButton.style.backgroundColor = '#ffffff';
    viewButton.style.border = '1px solid #ccc';
    viewButton.style.borderRadius = '5px';
    viewButton.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
    document.body.appendChild(viewButton);

    viewButton.addEventListener('click', () => {
        usingOverheadView = !usingOverheadView;
        if (usingOverheadView) {
            activateOverheadView(); 
        } else {
            activateFirstPersonView(); 
        }
    });
}

// Top down camera integration
function setupOverheadView() { 
    overheadView = new THREE.OrthographicCamera(
        -150, 150, 150, -150, 1, 1000
    );
    overheadView.position.set(0, 300, 0);
    overheadView.lookAt(0, 0, 0);
}
//Switch to the top-down camera
function activateOverheadView() { 
    playerControls.unlock();
    view = overheadView; 
    const button = document.querySelector('button');
    if(button) button.textContent = 'First-Person View';
}

// FPV camera to navigate through the island
function activateFirstPersonView() { 
    view = playerControls.getObject(); 
    playerControls.lock();
    const button = document.querySelector('button');
    if(button) button.textContent = 'Top-Down View';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupScene); 
} else {
    setupScene(); 
}