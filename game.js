import * as THREE from 'three';

// --- Constants ---
const BASE_GRID_SIZE_VISIBLE = 20; // How many "base tiles" are visible at zoom level 0
const TILE_SIZE = 1;          // World unit size of one logical grid tile

const SNAKE_HEAD_COLOR = 0x39d353;
const SNAKE_BODY_COLOR = 0x26a641;
const FOOD_COLOR = 0x58a6ff; // Blue for food
const POWERUP_COLORS = {
    SPEED_BOOST: 0xffd700, // Gold
    SHIELD: 0x87cefa,      // LightSkyBlue
    ESSENCE_RUSH: 0xda70d6, // Orchid
    FOOD_MAGNET: 0xAFEEEE, // PaleTurquoise
};

const INITIAL_MOVE_INTERVAL = 0.20; // Slightly faster
const POWERUP_DURATION = 7;
const LENGTH_MILESTONES = [5, 12, 22, 35, 55, 80, 110, 150, 200, 260]; // Length to reach next size level
const CAMERA_ZOOM_FACTORS = [1, 1.3, 1.7, 2.2, 2.8, 3.5, 4.3, 5.2, 6.2, 7.5]; // How much the view expands per size level

// --- Enemy Definitions ---
const ENEMY_TYPES = {
    PELLET: { // Small, always edible, like alternative food
        label: "Energy Pellet",
        color: 0x8888dd,
        visualScale: 0.6, // Relative to TILE_SIZE
        essence: 1,
        sizeRequirement: 0, // Snake size level needed to "defeat"
        minSpawnSizeLevel: 0, // Game size level when it starts spawning
        isHostile: false, // Doesn't kill player on contact if undersized
        colliderType: 'sphere',
        health: 1, // Simple enemies are 1 hit
    },
    GRUNT: {
        label: "Space Mite",
        color: 0xffcc00, // Yellowish
        visualScale: 0.8,
        essence: 5,
        sizeRequirement: 0, // Can be eaten by smallest snake
        minSpawnSizeLevel: 0,
        isHostile: true,
        colliderType: 'box',
        health: 1,
        attackPattern: 'static', // or 'moveSlowly'
    },
    GUARD: {
        label: "Void Sentinel",
        color: 0xff6666, // Reddish
        visualScale: 1.2,
        essence: 15,
        sizeRequirement: 1, // Needs snake size level 1
        minSpawnSizeLevel: 1,
        isHostile: true,
        colliderType: 'box',
        health: 2,
        attackPattern: 'static',
    },
    TITAN: {
        label: "Cosmic Behemoth",
        color: 0xcc66ff, // Purplish
        visualScale: 2.0,
        essence: 50,
        sizeRequirement: 3, // Needs snake size level 3
        minSpawnSizeLevel: 2, // Starts appearing when player is size 2
        isHostile: true,
        colliderType: 'box',
        health: 5,
        attackPattern: 'static',
    },
    Goliath: {
        label: "Cosmic Goliath",
        color: 0x66ffcc, // Purplish
        visualScale: 2.5,
        essence: 100,
        sizeRequirement: 4, // Needs snake size level 3
        minSpawnSizeLevel: 3, // Starts appearing when player is size 2
        isHostile: true,
        colliderType: 'tetrahedron',
        health: 6,
        attackPattern: 'static',
    }
};
const MAX_ENEMIES_ON_SCREEN = 8;


// --- Three.js Scene Setup ---
let scene, camera, renderer, gameGroup;
let ambientLight, directionalLight;
const gameContainer = document.getElementById('game-container');
const canvasContainer = document.getElementById('game-container');

function initThree() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x010409, BASE_GRID_SIZE_VISIBLE * 1.5, BASE_GRID_SIZE_VISIBLE * 3);

    gameGroup = new THREE.Group(); // For all dynamic game elements
    scene.add(gameGroup);

    // Camera: Orthographic, will be adjusted by zoom
    const aspect = 1; // Canvas will be kept square
    const initialViewRadius = BASE_GRID_SIZE_VISIBLE * TILE_SIZE / 2;
    camera = new THREE.OrthographicCamera(
        -initialViewRadius * aspect, initialViewRadius * aspect,
        initialViewRadius, -initialViewRadius,
        0.1, 1000 // Adjusted near/far
    );
    camera.position.set(0, BASE_GRID_SIZE_VISIBLE * 1.2, 0); // Positioned above
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    gameContainer.appendChild(renderer.domElement);

    ambientLight = new THREE.AmbientLight(0x607080, 0.8); // Cooler ambient
    scene.add(ambientLight);
    directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(10, 20, 15);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 50;
    // Shadow camera frustum will need to update with zoom!
    updateShadowCamera(CAMERA_ZOOM_FACTORS[0]);
    scene.add(directionalLight);

    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(1, 1); // Unit plane, will be scaled


    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x080c10, side: THREE.DoubleSide });
    const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    groundPlane.name = "ground";
    // Scale of ground plane will be updated with camera zoom
    gameGroup.add(groundPlane);

    onWindowResize(); // Set initial size and camera based on current sizeLevel (0)
}

function updateCameraAndWorldScale(sizeLevel) {
    const zoomFactor = CAMERA_ZOOM_FACTORS[Math.min(sizeLevel, CAMERA_ZOOM_FACTORS.length - 1)];
    const currentVisibleGridRadius = (BASE_GRID_SIZE_VISIBLE * TILE_SIZE / 2) * zoomFactor;

    // Update Orthographic Camera
    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight || 1;
    camera.left = -currentVisibleGridRadius * aspect;
    camera.right = currentVisibleGridRadius * aspect;
    camera.top = currentVisibleGridRadius;
    camera.bottom = -currentVisibleGridRadius;
    camera.position.y = (BASE_GRID_SIZE_VISIBLE * 1.2) * zoomFactor; // Move camera further away
    camera.updateProjectionMatrix();

    // Scale the ground plane to fill the new view
    const ground = gameGroup.getObjectByName("ground");
    if (ground) {
        ground.scale.set(currentVisibleGridRadius * 2.5, currentVisibleGridRadius * 2.5, 1); // Make it a bit larger than view
    }

    // Update shadow camera for directional light
    updateShadowCamera(zoomFactor);

    // Update Fog
    if (scene.fog) {
        scene.fog.near = currentVisibleGridRadius * 1.5;
        scene.fog.far = currentVisibleGridRadius * 3;
    }
}

function updateShadowCamera(zoomFactor) {
    const shadowCamSize = (BASE_GRID_SIZE_VISIBLE * TILE_SIZE / 2) * zoomFactor * 1.1; // Match view area + buffer
    directionalLight.shadow.camera.left = -shadowCamSize;
    directionalLight.shadow.camera.right = shadowCamSize;
    directionalLight.shadow.camera.top = shadowCamSize;
    directionalLight.shadow.camera.bottom = -shadowCamSize;
    directionalLight.shadow.camera.updateProjectionMatrix();
}


function onWindowResize() {
    // ... (similar to before, but now calls updateCameraAndWorldScale) ...
    if (!renderer || !camera || !canvasContainer) return;
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    const canvasSize = Math.min(containerWidth, containerHeight); // Keep it square
    renderer.setSize(canvasSize, canvasSize);
    renderer.color = 0xFF0000; // Reset color to default
    updateCameraAndWorldScale(currentSizeLevel); // Re-apply zoom for current level
}

// --- Game State & Logic ---
let snake, food, enemies, powerUps; // enemies is an array of THREE.Mesh objects
let direction, nextDirection;
let runEssence, currentSnakeLength;
let moveAccumulator, currentMoveInterval;
let isGameOver, isPaused, canProcessInput;
let activePowerUp = null;

let currentSizeLevel = 0; // Player's current achieved size level in this run
let highestSizeLevelAchieved = 0; // For global stat

// --- Persistent Data (Upgrades & Prestige) ---
let persistentData = {
    totalEssence: 0, highestOverallSizeLevel: 0, prestigePoints: 0,
    upgrades: {
        growthPotential: { level: 0, baseCost: 50, costMultiplier: 1.8, value: 0, increment: 1, label: "Max Size Level", rarity: "epic", icon: "🌱", maxLevel: LENGTH_MILESTONES.length -1 },
        moveSpeed: { level: 0, baseCost: 50, costMultiplier: 1.8, value: INITIAL_MOVE_INTERVAL, increment: -0.007, maxLevel: 15, label: "Move Speed", rarity: "common", icon: "⏩" },
        essenceGain: { level: 0, baseCost: 30, costMultiplier: 1.6, value: 1, increment: 0.2, label: "Essence Gain", rarity: "rare", icon: "💎" },
        powerUpChance: { level: 0, baseCost: 75, costMultiplier: 1.7, value: 0.08, increment: 0.02, maxLevel: 20, label: "Power-up Rate", rarity: "rare", icon: "⭐" },
        powerUpDuration: { level: 0, baseCost: 60, costMultiplier: 1.5, value: POWERUP_DURATION, increment: 1, label: "Power-up Time", rarity: "common", icon: "⏱️" },
        // Removed Score Multiplier as score is less relevant now
    },
    prestigeUpgrades: {
        globalEssenceBoost: { level: 0, baseCost: 1, costMultiplier: 2, value: 1, increment: 0.05, label: "Global Essence Boost (%)" }, // 1 = +0%, 1.05 = +5%
        startWithShield: { level: 0, baseCost: 3, costMultiplier: 3, value: 0, increment: 1, maxLevel: 1, label: "Start with Shield" },
    },
    nextPrestigeEssenceCost: 15000, // Increased cost
};
// ... (getUpgradeCost, purchaseUpgrade, performPrestige, saveProgress, loadProgress mostly same, ensure highSize is saved/loaded)

function getUpgradeCost(upgradeKey, type = 'upgrades') {
    const upg = persistentData[type][upgradeKey];
    if (!upg) return Infinity;
    return Math.floor(upg.baseCost * Math.pow(upg.costMultiplier, upg.level));
}

function purchaseUpgrade(upgradeKey, type = 'upgrades') {
    const upg = persistentData[type][upgradeKey];
    const currency = type === 'upgrades' ? 'totalEssence' : 'prestigePoints';
    const cost = getUpgradeCost(upgradeKey, type);

    if (persistentData[currency] >= cost && (!upg.maxLevel || upg.level < upg.maxLevel)) {
        persistentData[currency] -= cost;
        upg.level++;
        if (upgradeKey === 'moveSpeed') { 
            upg.value = Math.max(0.05, upg.value + upg.increment); 
        } else {
            upg.value += upg.increment;
        }
        saveProgress();
        updateUI(); // This will now update cards on both splash and game UI
        if (document.getElementById('splash-screen').style.display !== 'none') {
            populateUpgradeCards('splash-upgrades-container', 'upgrades'); // Refresh splash screen cards
        }
        return true;
    }
    return false;
}

function showMessage(title, text, buttonText, action) {
    messageTitle.textContent = title;
    messageText.innerHTML = text;
    if (title === "Game Over!") {
        messageSubText.innerHTML = `Essence this run: ${runEssence.toLocaleString()}`;
        messageSubText.style.display = 'block';
    } else {
        messageSubText.style.display = 'none';
    }
    messageActionButton.textContent = buttonText;
    messageActionButton.onclick = () => {
        messageOverlay.style.display = 'none';
        action();
    };
    messageOverlay.style.display = 'flex';
    isPaused = true; // Pause game when message is shown (if game is running)
    if (title !== "Game Over!") isPaused = true; else isGameOver = true;
}

function performPrestige() {
    if (persistentData.totalEssence >= persistentData.nextPrestigeEssenceCost) {
        persistentData.prestigePoints++;
        persistentData.totalEssence = 0; 

        for (const key in persistentData.upgrades) {
            const upg = persistentData.upgrades[key];
            upg.level = 0;
            // Reset value to base (need to store baseValue or re-calculate carefully)
            // For simplicity, hardcoding base values on reset:
            if (key === 'startLength') upg.value = 3;
            else if (key === 'moveSpeed') upg.value = INITIAL_MOVE_INTERVAL;
            else if (key === 'essenceGain') upg.value = 1;
            else if (key === 'powerUpChance') upg.value = 0.1;
            else if (key === 'powerUpDuration') upg.value = POWERUP_DURATION;
            else if (key === 'scoreMultiplier') upg.value = 1;
        }
        persistentData.nextPrestigeEssenceCost = Math.floor(persistentData.nextPrestigeEssenceCost * 2.5); 

        saveProgress();
        updateUI();
         if (document.getElementById('splash-screen').style.display !== 'none') {
            populateUpgradeCards('splash-upgrades-container', 'upgrades');
        }
        showMessage("Prestiged!", `You gained 1 Prestige Point! Regular upgrades reset. Next prestige at ${persistentData.nextPrestigeEssenceCost.toLocaleString()} Essence.`, "Continue", () => {
            messageOverlay.style.display = 'none'; // Just close message
            if (isGameOver) showSplashScreen(); // If game was over, go to splash
        });
    }
}


function saveProgress() {
    persistentData.highestOverallSizeLevel = Math.max(persistentData.highestOverallSizeLevel, highestSizeLevelAchieved);
    localStorage.setItem('serpentScaleProgress', JSON.stringify(persistentData));
}
function loadProgress() {
    const saved = localStorage.getItem('serpentScaleProgress');
    if (saved) {
        const loadedData = JSON.parse(saved);
        // Smart merge:
        persistentData.totalEssence = loadedData.totalEssence || 0;
        persistentData.highestOverallSizeLevel = loadedData.highestOverallSizeLevel || 0; // Load this new stat
        persistentData.prestigePoints = loadedData.prestigePoints || 0;
        persistentData.nextPrestigeEssenceCost = loadedData.nextPrestigeEssenceCost || 15000;

        for (const type of ['upgrades', 'prestigeUpgrades']) {
            if(loadedData[type]) {
                for (const key in persistentData[type]) { // Iterate over current defaults
                    if (loadedData[type][key]) {
                        persistentData[type][key] = { ...persistentData[type][key], ...loadedData[type][key] };
                    }
                }
            }
        }
         // Ensure maxLevel for growthPotential is correct if it changed in code
        if (persistentData.upgrades.growthPotential) {
            persistentData.upgrades.growthPotential.maxLevel = LENGTH_MILESTONES.length -1;
        }
    }
}


// --- Game Object Creation (Snake, Food, Enemies) ---
function worldToGridPos(worldVec) {
    // Approximate, assumes TILE_SIZE is 1 and origin is center of conceptual grid
    return new THREE.Vector2(
        Math.round(worldVec.x / TILE_SIZE + (BASE_GRID_SIZE_VISIBLE * CAMERA_ZOOM_FACTORS[currentSizeLevel] / 2) - 0.5),
        Math.round(worldVec.z / TILE_SIZE + (BASE_GRID_SIZE_VISIBLE * CAMERA_ZOOM_FACTORS[currentSizeLevel] / 2) - 0.5)
    );
}
function gridToWorldPos(gridPos) {
    // const effectiveGridRadius = BASE_GRID_SIZE_VISIBLE * CAMERA_ZOOM_FACTORS[currentSizeLevel] / 2;
    // return new THREE.Vector3(
    //     (gridPos.x - effectiveGridRadius + 0.5) * TILE_SIZE,
    //     TILE_SIZE / 2, // Y-position for objects on the plane
    //     (gridPos.y - effectiveGridRadius + 0.5) * TILE_SIZE
    // );

    return new THREE.Vector3(gridPos.x * TILE_SIZE, TILE_SIZE / 2, gridPos.y * TILE_SIZE); // Simplified for now
}


function createSnakeSegment(gridPos, isHead = false) {
    const geometry = new THREE.BoxGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9, TILE_SIZE * 0.9);
    const material = new THREE.MeshStandardMaterial({
        color: isHead ? SNAKE_HEAD_COLOR : SNAKE_BODY_COLOR,
        metalness: 0.3, roughness: 0.6
    });
    const segment = new THREE.Mesh(geometry, material);
    // Position calculation now needs to account for the current effective grid center due to zoom
    // For simplicity, we'll keep gridPos relative to a logical 0,0 center and map to world.
    // The grid itself expands, so snake positions are on a larger conceptual grid.
    segment.position.copy(gridToWorldPos(gridPos)); // Use new positioning
    segment.userData = { gridPos: gridPos.clone(), type: 'snake' };
    segment.castShadow = true;
    gameGroup.add(segment);
    return segment;
}

function createPowerUp(gridPos, type) {
    // Using simpler geometry for now, easier to see
    const geometry = new THREE.OctahedronGeometry(TILE_SIZE * 0.35, 0); 
    const material = new THREE.MeshStandardMaterial({
        color: POWERUP_COLORS[type] || 0xffffff, emissive: POWERUP_COLORS[type] || 0xffffff,
        emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.4,
    });
    const powerUpItem = new THREE.Mesh(geometry, material);
    powerUpItem.position.set(
        (gridPos.x - BASE_GRID_SIZE_VISIBLE / 2) * TILE_SIZE, TILE_SIZE / 2,
        (gridPos.y - BASE_GRID_SIZE_VISIBLE / 2) * TILE_SIZE
    );
    powerUpItem.userData = { gridPos: gridPos.clone(), type };
    powerUpItem.castShadow = true;
    gameGroup.add(powerUpItem);
    return powerUpItem;
}

function createFood(gridPos) {
    const geometry = new THREE.IcosahedronGeometry(TILE_SIZE * 0.4, 0); // Simpler sphere
    const material = new THREE.MeshStandardMaterial({
        color: FOOD_COLOR, emissive: FOOD_COLOR, emissiveIntensity: 0.4,
    });
    const foodItem = new THREE.Mesh(geometry, material);
    foodItem.position.copy(gridToWorldPos(gridPos));
    foodItem.userData = { gridPos: gridPos.clone(), type: 'food' };
    foodItem.castShadow = true;
    gameGroup.add(foodItem);
    return foodItem;
}

function createEnemy(gridPos, enemyKey) {
    const type = ENEMY_TYPES[enemyKey];
    let geometry;
    if (type.colliderType === 'sphere') {
        geometry = new THREE.SphereGeometry(TILE_SIZE * type.visualScale * 0.5, 8, 6);
    } else if (type.colliderType === 'tetrahedron') {
        geometry = new THREE.TetrahedronGeometry(TILE_SIZE * type.visualScale * 0.5, 8, 6);
    } else  { // box default
        geometry = new THREE.BoxGeometry(TILE_SIZE * type.visualScale, TILE_SIZE * type.visualScale, TILE_SIZE * type.visualScale);
    }
    const material = new THREE.MeshStandardMaterial({
        color: type.color,
        metalness: 0.4, roughness: 0.5,
        emissive: type.color, emissiveIntensity: 0.2
    });
    const enemyMesh = new THREE.Mesh(geometry, material);
    enemyMesh.position.copy(gridToWorldPos(gridPos));
    enemyMesh.userData = {
        gridPos: gridPos.clone(),
        type: 'enemy',
        enemyKey: enemyKey,
        health: type.health,
        definition: type // Store full definition
    };
    enemyMesh.castShadow = true;
    gameGroup.add(enemyMesh);
    return enemyMesh;
}

// --- Game Flow & Mechanics ---
function transitionToGame() {
    document.getElementById('splash-screen').classList.add('splash-hidden');
    document.getElementById('main-content').classList.remove('hidden');
    document.getElementById('main-content').style.display = 'flex'; // Ensure it's flex
    
    // Delay start game slightly to allow CSS transition
    setTimeout(() => {
        onWindowResize();
        startGame();
    }, 50); // Matches CSS transition roughly
}

function showSplashScreen() {
    document.getElementById('splash-screen').classList.remove('splash-hidden');
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('main-content').style.display = 'none';
    isGameOver = true;
    populateUpgradeCards('splash-upgrades-container', 'upgrades');
    updateUI();
}

function startGame() {
    isGameOver = false; isPaused = false; canProcessInput = false;
    runEssence = 0; currentSnakeLength = 0; // Reset length
    currentSizeLevel = 0; // Reset size level for the run
    highestSizeLevelAchieved = 0;
    updateCameraAndWorldScale(currentSizeLevel); // Initial camera setup for level 0

    direction = new THREE.Vector2(1, 0);
    nextDirection = new THREE.Vector2(0, -1);

    snake = []; enemies = []; food = null; activePowerUp = null;
    
    //snake.reverse(); // Head is now snake[0]
    //currentSnakeLength = snake.length;

    powerUps = []; // Clear array of power-up objects
    activePowerUp = null;
    food = null; // Ensure food object is cleared

    moveAccumulator = 0;
    currentMoveInterval = persistentData.upgrades.moveSpeed.value;


    

    // Clear previous game objects (more robust clearing)
    const toRemove = [];
    gameGroup.children.forEach(child => {
        if (child.name !== "ground") toRemove.push(child);
    });
    toRemove.forEach(child => gameGroup.remove(child));


    // Initial Snake (always starts at 3 segments for consistency, length for milestones handles growth)
    const initialSegments = 3;
    const startGridX = Math.floor(BASE_GRID_SIZE_VISIBLE / 4);
    const startGridY = Math.floor(BASE_GRID_SIZE_VISIBLE / 2);
    for (let i = 0; i < initialSegments; i++) {
        const gridPos = new THREE.Vector2(startGridX + i, startGridY);
        snake.unshift(createSnakeSegment(gridPos, i === initialSegments - 1));
    }
    snake.reverse(); // Head is now snake[0]
    currentSnakeLength = snake.length;

    spawnFood();
    // Spawn initial enemies if any
    for(let i=0; i < 2; i++) spawnEnemy();


    if (persistentData.prestigeUpgrades.startWithShield.value > 0 && !activePowerUp) {
        activatePowerUp("SHIELD", persistentData.upgrades.powerUpDuration.value * 1.5);
    }

    document.getElementById('message-overlay').style.display = 'none';
    updateUI();
    setTimeout(() => { canProcessInput = true; }, 20);
    if (!animationFrameId) gameLoop();
}

function getValidSpawnPosition(occupiedPositions) {
    let spawnPos;
    const currentGridSpan = BASE_GRID_SIZE_VISIBLE * CAMERA_ZOOM_FACTORS[currentSizeLevel];
    const halfSpan = Math.floor(currentGridSpan / 2);
    let attempts = 0;
    do {
        spawnPos = new THREE.Vector2(
            Math.floor(Math.random() * currentGridSpan) - halfSpan,
            Math.floor(Math.random() * currentGridSpan) - halfSpan
        );
        attempts++;
    } while (occupiedPositions.has(`${spawnPos.x},${spawnPos.y}`) && attempts < 100);
    if (attempts >= 100) return null; // Failed to find a spot
    return spawnPos;
}

function spawnFood() {
    if (food && food.parent) gameGroup.remove(food); food = null;

    const occupied = new Set();
    snake.forEach(seg => occupied.add(`${seg.userData.gridPos.x},${seg.userData.gridPos.y}`));
    enemies.forEach(e => occupied.add(`${e.userData.gridPos.x},${e.userData.gridPos.y}`));

    const foodPos = getValidSpawnPosition(occupied);
    if (foodPos) food = createFood(foodPos);
}

function spawnEnemy() {
    if (enemies.length >= MAX_ENEMIES_ON_SCREEN) return;

    const availableEnemyKeys = Object.keys(ENEMY_TYPES).filter(key =>
        ENEMY_TYPES[key].minSpawnSizeLevel <= currentSizeLevel
    );
    if (availableEnemyKeys.length === 0) return;

    const enemyKey = availableEnemyKeys[Math.floor(Math.random() * availableEnemyKeys.length)];

    const occupied = new Set();
    snake.forEach(seg => occupied.add(`${seg.userData.gridPos.x},${seg.userData.gridPos.y}`));
    enemies.forEach(e => occupied.add(`${e.userData.gridPos.x},${e.userData.gridPos.y}`));
    if (food) occupied.add(`${food.userData.gridPos.x},${food.userData.gridPos.y}`);

    const enemyPos = getValidSpawnPosition(occupied);
    if (enemyPos) enemies.push(createEnemy(enemyPos, enemyKey));
}


function checkSizeLevelUp() {
    const maxAchievableSizeLevel = persistentData.upgrades.growthPotential.value;
    if (currentSizeLevel < maxAchievableSizeLevel &&
        currentSizeLevel < LENGTH_MILESTONES.length && // Ensure we don't go out of bounds for milestones
        currentSnakeLength >= LENGTH_MILESTONES[currentSizeLevel]) {
        currentSizeLevel++;
        highestSizeLevelAchieved = Math.max(highestSizeLevelAchieved, currentSizeLevel);
        playSound('levelUp');

        updateCameraAndWorldScale(currentSizeLevel);
        // Potentially add a small temporary buff or visual effect on level up
        // console.log(`Reached Size Level: ${currentSizeLevel}`);
    }
}

function handleFoodCollision(newHeadGridPos) {
    if (food && newHeadGridPos.equals(food.userData.gridPos)) {
        // Score is removed, length is the progression
        let essenceFromFood = Math.floor(ENEMY_TYPES.PELLET.essence * persistentData.upgrades.essenceGain.value * persistentData.prestigeUpgrades.globalEssenceBoost.value);
        if (activePowerUp && activePowerUp.type === 'ESSENCE_RUSH') essenceFromFood *= 2.5;
        
        runEssence += essenceFromFood;
        persistentData.totalEssence += essenceFromFood;

        if (food.parent) gameGroup.remove(food); food = null;
        spawnFood();
        spawnPowerUp(); // Power-ups are still generic, not tied to length specifically

        // Snake grows one segment - this is the primary growth mechanism
        // The new head is already added, so we just don't remove tail
        currentSnakeLength++;
        playSound('eat', 1.0, 1.0 + Math.random() * 0.2 - 0.1); // Play sound on food eaten
        checkSizeLevelUp(); // Check if this new length triggers a size level up
        return true; // Ate food, don't remove tail
    }
    return false;
}

function handleEnemyCollision(newHeadGridPos) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (newHeadGridPos.equals(enemy.userData.gridPos)) {
            const enemyDef = enemy.userData.definition;
            if (currentSizeLevel >= enemyDef.sizeRequirement) { // Can defeat
                runEssence += Math.floor(enemyDef.essence * persistentData.upgrades.essenceGain.value * persistentData.prestigeUpgrades.globalEssenceBoost.value);
                persistentData.totalEssence += Math.floor(enemyDef.essence * persistentData.upgrades.essenceGain.value * persistentData.prestigeUpgrades.globalEssenceBoost.value);
                
                if (enemy.parent) gameGroup.remove(enemy);
                enemies.splice(i, 1);
                spawnEnemy(); // Replace defeated enemy
                playSound('enemyDefeat');
                // No snake growth from enemies, only essence. Growth is from food.
            } else { // Undersized for this enemy
                if (enemyDef.isHostile) {
                    triggerGameOver(`Defeated by a ${enemyDef.label}!`);
                    return true; // Game over processed
                } else { // Non-hostile (like Pellet), just pass through or collect if conditions met elsewhere
                    // This specific 'PELLET' type enemy is handled like food for essence.
                    if (enemyDef.label === "Energy Pellet") { // Special case for pellet
                         runEssence += Math.floor(enemyDef.essence * persistentData.upgrades.essenceGain.value * persistentData.prestigeUpgrades.globalEssenceBoost.value);
                         persistentData.totalEssence += Math.floor(enemyDef.essence * persistentData.upgrades.essenceGain.value * persistentData.prestigeUpgrades.globalEssenceBoost.value);
                         if (enemy.parent) gameGroup.remove(enemy);
                         enemies.splice(i, 1);
                         spawnEnemy();
                    }
                }
            }
            break; // Processed one enemy collision
        }
    }
    return false; // No game-ending collision
}

// activatePowerUp, deactivatePowerUp, handlePowerUpCollision (mostly same)
// ... (Keep these functions. Power-ups don't directly grant length anymore)
// spawnPowerUp (similar, just ensure it uses getValidSpawnPosition)
function activatePowerUp(type, durationOverride = null) {
    if (activePowerUp && activePowerUp.mesh && activePowerUp.mesh.parent) {
         if(activePowerUp.type === 'SHIELD' && snake[0]) snake[0].material.emissive.setHex(0x0000FF);
    }

    const duration = durationOverride !== null ? durationOverride : persistentData.upgrades.powerUpDuration.value;
    activePowerUp = { type, timeLeft: duration, mesh: null };

    switch (type) {
        case 'SPEED_BOOST': currentMoveInterval /= 1.75; break; // Less drastic boost
        case 'SHIELD':
            if(snake[0]) {
                snake[0].material.emissive.setHex(POWERUP_COLORS.SHIELD);
                snake[0].material.emissiveIntensity = 0.7;
            }
            break;
    }
    updateUI();
}

function deactivatePowerUp() {
    if (!activePowerUp) return;
    switch (activePowerUp.type) {
        case 'SPEED_BOOST': currentMoveInterval = persistentData.upgrades.moveSpeed.value; break;
        case 'SHIELD': if(snake[0]) snake[0].material.emissive.setHex(0x000000); break;
    }
    activePowerUp = null;
    updateUI();
}

function updateBiomeVisuals() {
    const biome = BIOME_COLORS[currentBiomeIndex % BIOME_COLORS.length];
    const ground = gameGroup.getObjectByName("ground");
    if (ground) ground.material.color.setHex(biome.ground);
    
    ambientLight.color.setHex(biome.light);
    directionalLight.color.setHex(biome.light);
    if (scene.fog) {
        scene.fog.color.setHex(biome.fog);
        scene.fog.near = GAME_PLANE_SIZE * 0.7;
        scene.fog.far = GAME_PLANE_SIZE * 1.8 + (currentBiomeIndex * TILE_SIZE * 2); // Fog gets denser/closer in later biomes
    }
}

function spawnPowerUp() {
    if (powerUps.length > 0 || Math.random() > persistentData.upgrades.powerUpChance.value) {
        return;
    }
    let powerUpPos;
    const occupiedPositions = snake.map(seg => seg.userData.gridPos.x + "," + seg.userData.gridPos.y);
    if (food) occupiedPositions.push(food.userData.gridPos.x + "," + food.userData.gridPos.y);
    powerUps.forEach(p => occupiedPositions.push(p.userData.gridPos.x + "," + p.userData.gridPos.y));

    do {
        powerUpPos = new THREE.Vector2(Math.floor(Math.random() * BASE_GRID_SIZE_VISIBLE), Math.floor(Math.random() * BASE_GRID_SIZE_VISIBLE));
    } while (occupiedPositions.includes(powerUpPos.x + "," + powerUpPos.y));

    const powerUpTypes = Object.keys(POWERUP_COLORS);
    const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    powerUps.push(createPowerUp(powerUpPos, type));
}

function handlePowerUpCollision(newHeadGridPos) {
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const p = powerUps[i];
        if (newHeadGridPos.equals(p.userData.gridPos)) {
            activatePowerUp(p.userData.type);
            if(p.parent) gameGroup.remove(p);
            powerUps.splice(i, 1);
            break;
        }
    }
}

function updateSnakeMovement() {
    direction.copy(nextDirection);
    const head = snake[0];
    const newHeadGridPos = head.userData.gridPos.clone().add(direction);

    // Wall Collision (relative to current dynamic grid size)

    debugInfoXPos.textContent = newHeadGridPos.x;
    debugInfoYPos.textContent = newHeadGridPos.y;

    const currentGridRadius = (BASE_GRID_SIZE_VISIBLE * CAMERA_ZOOM_FACTORS[currentSizeLevel] / 2);
    if (newHeadGridPos.x < -currentGridRadius || newHeadGridPos.x >= currentGridRadius ||
        newHeadGridPos.y < -currentGridRadius || newHeadGridPos.y >= currentGridRadius) {
        if (activePowerUp && activePowerUp.type === 'SHIELD') { /* ... shield logic ... */ }
        else { triggerGameOver("Lost in the Void (hit a wall)!"); return; }
    }

    // Self Collision
    for (let i = 1; i < snake.length; i++) { // Start from 1, head cannot collide with itself
        if (newHeadGridPos.equals(snake[i].userData.gridPos)) {
            if (activePowerUp && activePowerUp.type === 'SHIELD') { /* ... shield logic ... */ }
            else { triggerGameOver("Consumed by your own mass!"); return; }
        }
    }

    // Enemy Collision (before adding new head, check if new spot is an enemy)
    if (handleEnemyCollision(newHeadGridPos)) return; // Game Over handled by it

    // Add new head
    const newHead = createSnakeSegment(newHeadGridPos, true);
    snake.unshift(newHead);
    if (snake.length > 1) snake[1].material.color.setHex(SNAKE_BODY_COLOR);

    // Food Collision (after adding new head, check if new head is on food)
    const ateFood = handleFoodCollision(newHeadGridPos);
    handlePowerUpCollision(newHeadGridPos); // Check for power-ups

    if (!ateFood) { // If no food eaten, remove tail
        const tail = snake.pop();
        if (tail.parent) gameGroup.remove(tail);
    } else {
        // currentSnakeLength was already incremented in handleFoodCollision
    }
}


function triggerGameOver(reason) {
    isGameOver = true; canProcessInput = false;
    playSound('gameOver');

    persistentData.highestOverallSizeLevel = Math.max(persistentData.highestOverallSizeLevel, highestSizeLevelAchieved);
    saveProgress();
    showMessage("Run Terminated!", `${reason}<br>Final Size Lvl: ${currentSizeLevel} | Length: ${currentSnakeLength}`, "Return to Hub", showSplashScreen);
    updateUI();
}


// --- UI Management ---
const statScoreEl = document.getElementById('stat-score');
const statRunEssenceEl = document.getElementById('stat-run-essence');
const statTotalEssenceEl = document.getElementById('stat-total-essence');
const statHighScoreEl = document.getElementById('stat-high-score');
const statActivePowerupEl = document.getElementById('stat-active-powerup');

const debugInfoXPos = document.getElementById('debug-info-xpos');
const debugInfoYPos = document.getElementById('debug-info-ypos');


const upgradesSectionEl = document.getElementById('upgrades-section'); // In-game UI
const prestigeUpgradesSectionEl = document.getElementById('prestige-upgrades-section'); // In-game UI
const statPrestigePointsEl = document.getElementById('stat-prestige-points');
const prestigeCostEl = document.getElementById('prestige-cost');
const btnPrestigeEl = document.getElementById('btn-prestige');

const messageOverlay = document.getElementById('message-overlay');
const messageTitle = document.getElementById('message-title');
const messageText = document.getElementById('message-text');
const messageSubText = document.getElementById('message-subtext');
const messageActionButton = document.getElementById('message-action-button');
const statSizeLevelEl = document.getElementById('stat-size-level');
const statLengthEl = document.getElementById('stat-length');
const statHighSizeEl = document.getElementById('stat-high-size');

function updateUI() {
    // Update stats
    statSizeLevelEl.textContent = currentSizeLevel;
    statLengthEl.textContent = currentSnakeLength;
    statRunEssenceEl.textContent = runEssence;
    statTotalEssenceEl.textContent = persistentData.totalEssence.toLocaleString();
    statHighSizeEl.textContent = persistentData.highestOverallSizeLevel; // New global stat
    statPrestigePointsEl.textContent = persistentData.prestigePoints.toLocaleString();
    prestigeCostEl.textContent = persistentData.nextPrestigeEssenceCost.toLocaleString();

    if (activePowerUp) { /* ... same ... */ } else { statActivePowerupEl.textContent = "None"; }

    populateUpgradeCards('upgrades-section', 'upgrades');
    populateUpgradeCards('prestige-upgrades-section', 'prestigeUpgrades');
    if (document.getElementById('splash-screen').classList.contains('splash-hidden') === false) {
        populateUpgradeCards('splash-upgrades-container', 'upgrades');
    }
    btnPrestigeEl.disabled = persistentData.totalEssence < persistentData.nextPrestigeEssenceCost;
}
// formatUpgradeValue, populateUpgradeCards (mostly same, ensure growthPotential is handled)
function populateUpgradeCards(containerId, upgradeTypeKey) {
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;
    containerEl.innerHTML = ''; // Clear previous cards

    const upgrades = persistentData[upgradeTypeKey];
    const currency = upgradeTypeKey === 'upgrades' ? 'totalEssence' : 'prestigePoints';
    const currencySymbol = upgradeTypeKey === 'upgrades' ? 'E' : 'PP';

    for (const key in upgrades) {
        const upg = upgrades[key];
        const cost = getUpgradeCost(key, upgradeTypeKey);
        const card = document.createElement('div');
        card.classList.add('upgrade-card', `rarity-${upg.rarity || 'common'}`);

        const valueDisplay = formatUpgradeValue(key, upg.value);
        let nextValueDisplay = "";
        if (!upg.maxLevel || upg.level < upg.maxLevel) {
            let nextValue = upg.value + upg.increment;
            if (key === 'moveSpeed') nextValue = Math.max(0.05, upg.value + upg.increment);
            nextValueDisplay = `Next: ${formatUpgradeValue(key, nextValue)}`;
        }


        card.innerHTML = `
            <div class="card-header">
                <span class="card-icon">${upg.icon || '❓'}</span>
                <span class="card-title">${upg.label}</span>
                <span class="card-level">Lvl ${upg.level}</span>
            </div>
            <div class="card-content">
                <p class="card-effect">Current: <strong>${valueDisplay}</strong></p>
                ${nextValueDisplay ? `<p class="card-next-effect">${nextValueDisplay}</p>` : ''}
                <p class="card-cost">${upg.maxLevel && upg.level >= upg.maxLevel ? 'Max Level Reached' : `Cost: ${cost.toLocaleString()} ${currencySymbol}`}</p>
            </div>
            <button data-key="${key}" data-type="${upgradeTypeKey}" 
                ${persistentData[currency] < cost || (upg.maxLevel && upg.level >= upg.maxLevel) ? 'disabled' : ''}>
                ${upg.maxLevel && upg.level >= upg.maxLevel ? 'MAXED' : 'Purchase'}
            </button>
        `;
        containerEl.appendChild(card);
    }
}

// ... (Keep these, small adjustments for new upgrade name might be needed in formatUpgradeValue)
function formatUpgradeValue(key, value) {
    if (key === 'growthPotential') return `Lvl ${Math.floor(value)} (Max ${LENGTH_MILESTONES.length -1})`;
    // ... rest of the function
    if (key === 'moveSpeed') return `${value.toFixed(3)}s`;
    if (key === 'powerUpChance') return `${(value * 100).toFixed(0)}%`;
    if (key === 'essenceGain') return `x${value.toFixed(1)}`;
    if (key === 'globalEssenceBoost') return `+${((value -1) * 100).toFixed(0)}%`;
    if (key === 'startWithShield') return value > 0 ? 'Active' : 'Inactive';
    return Math.floor(value);
}


// --- Event Listeners & Main Game Loop (mostly same) ---

// --- Event Listeners ---
function setupEventListeners() {
    window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        const isDirectionalKey = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key);

        // Allow 'P' for pause/resume regardless of canProcessInput if game is not over.
        // For directional keys, game must be active AND canProcessInput must be true.
        if (isDirectionalKey) {
            if (!canProcessInput || isGameOver || isPaused) {
                event.preventDefault(); // Good practice to prevent default for game keys
                return;
            }
        } else if (key === 'p') {
            if (isGameOver) { // Don't allow pause if game over
                event.preventDefault();
                return;
            }
            // Pause logic will handle itself based on isPaused state
        } else {
            // Potentially other non-gameplay keys, or just ignore
            return;
        }

        // If we reach here, the key is relevant and game state allows processing (or it's a pause toggle)

        if (isDirectionalKey) {
            event.preventDefault(); // Prevent page scrolling with arrow keys
            switch (key) {
                case 'arrowup': case 'w':
                    if (direction.y === 0) nextDirection.set(0, -1);
                    break;
                case 'arrowdown': case 's':
                    if (direction.y === 0) nextDirection.set(0, 1);
                    break;
                case 'arrowleft': case 'a':
                    if (direction.x === 0) nextDirection.set(-1, 0);
                    break;
                case 'arrowright': case 'd':
                    if (direction.x === 0) nextDirection.set(1, 0);
                    break;
            }
        } else if (key === 'p') {
            event.preventDefault();
            if (isPaused && messageOverlay.style.display !== 'none' && messageTitle.textContent === "Paused") {
                isPaused = false;
                canProcessInput = true; // Re-enable input processing
                messageOverlay.style.display = 'none';
                if (!animationFrameId) gameLoop();
            } else if (!isPaused) {
                isPaused = true;
                // canProcessInput remains true, but gameLoop pauses. Or set false if desired.
                showMessage("Paused", "Game is paused. Press P to resume.", "Resume", () => {
                    isPaused = false;
                    canProcessInput = true; // Re-enable input processing
                    messageOverlay.style.display = 'none';
                    if (!animationFrameId) gameLoop();
                });
            }
        }
    });

    // Unified click handler for upgrade buttons (splash and game UI)
    document.body.addEventListener('click', (event) => {
        if (event.target.tagName === 'BUTTON' && event.target.dataset.key) {
            const key = event.target.dataset.key;
            const type = event.target.dataset.type;
            if (purchaseUpgrade(key, type) && audioCtx) playSound('uiClick'); // Play sound on successful purchase
        }
    });

    btnPrestigeEl.addEventListener('click', () => {
        if(performPrestige() && audioCtx) playSound('prestige');
    });

    btnPrestigeEl.addEventListener('click', performPrestige);
    document.getElementById('splash-start-button').addEventListener('click', () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
                playSound('uiConfirm'); // Play sound after context is resumed
                playMusic('music');     // Start music
                transitionToGame();
            }).catch(e => { // Fallback if resume fails or user doesn't interact
                console.warn("AudioContext resume failed. Starting game without sound interaction.", e);
                transitionToGame();
            });
        } else {
            if (audioCtx) {
                playSound('uiConfirm');
                playMusic('music');
            }
            transitionToGame();
        }
    });
    window.addEventListener('resize', onWindowResize);
}


// --- Main Game Loop ---
let lastTime = 0;
let animationFrameId = null;

function gameLoop(timestamp) {
    if (isGameOver || isPaused) {
        animationFrameId = null;
        if (renderer) renderer.render(scene, camera); // Render one last time for game over/pause screen
        return;
    }
    animationFrameId = requestAnimationFrame(gameLoop);

    const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.1) || 0; // Cap deltaTime, seconds
    lastTime = timestamp;

    moveAccumulator += deltaTime;

    if (activePowerUp) {
        activePowerUp.timeLeft -= deltaTime;
        if (activePowerUp.type === 'FOOD_MAGNET' && food && snake[0]) {
            const headPos = snake[0].position;
            const foodPos = food.position;
            const directionToHead = new THREE.Vector3().subVectors(headPos, foodPos).normalize();
            const magnetSpeed = TILE_SIZE * 2.5 * deltaTime;
            food.position.addScaledVector(directionToHead, magnetSpeed);
        }
        if (activePowerUp.timeLeft <= 0) {
            deactivatePowerUp();
        }
        // updateUI called less frequently, maybe on move or powerup change
    }

    powerUps.forEach(p => { p.rotation.y += 1.5 * deltaTime; p.rotation.x += 0.8 * deltaTime; });
    if (food) food.rotation.y += 0.5 * deltaTime;


    if (moveAccumulator >= currentMoveInterval) {
        moveAccumulator -= currentMoveInterval; // Subtract interval for more consistent timing
        updateSnakeMovement();
        if (!isGameOver) updateUI();
    }
    if (renderer) renderer.render(scene, camera);
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};
let musicSourceNode = null;
let masterGainNode = null; // For master volume control

if (audioCtx) {
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.setValueAtTime(0.7, audioCtx.currentTime); // Default master volume
    masterGainNode.connect(audioCtx.destination);
}

async function loadSound(name, url) {
    if (!audioCtx) return Promise.resolve(); // Resolve immediately if no audio context
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        sounds[name] = audioBuffer;
        // console.log(`Sound loaded: ${name}`);
    } catch (e) {
        console.error(`Error loading sound ${name} from ${url}:`, e);
        sounds[name] = null;
    }
}

function playSound(name, volume = 1.0, playbackRate = 1.0) {
    if (!audioCtx || !sounds[name] || !masterGainNode) {
        return;
    }
    if (audioCtx.state === 'suspended') { // Try to resume context if needed
        audioCtx.resume().catch(e => console.warn("Could not resume audio context for sound", e));
    }
    if (audioCtx.state !== 'running') return; // Don't play if context isn't running

    const source = audioCtx.createBufferSource();
    source.buffer = sounds[name];
    source.playbackRate.value = playbackRate;

    const soundGainNode = audioCtx.createGain();
    soundGainNode.gain.setValueAtTime(volume, audioCtx.currentTime);

    source.connect(soundGainNode);
    soundGainNode.connect(masterGainNode); // Connect to master gain
    source.start(0);
}

function playMusic(name, volume = 0.4, loop = true) {
    if (musicSourceNode) {
        try { musicSourceNode.stop(); } catch(e) {/*ignore*/}
        musicSourceNode.disconnect();
        musicSourceNode = null;
    }
    if (!audioCtx || !sounds[name] || !masterGainNode) {
        return;
    }
     if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.warn("Could not resume audio context for music", e));
    }
    if (audioCtx.state !== 'running') return;

    musicSourceNode = audioCtx.createBufferSource();
    musicSourceNode.buffer = sounds[name];
    musicSourceNode.loop = loop;

    const musicGainNode = audioCtx.createGain();
    musicGainNode.gain.setValueAtTime(volume, audioCtx.currentTime);

    musicSourceNode.connect(musicGainNode);
    musicGainNode.connect(masterGainNode); // Connect to master gain
    musicSourceNode.start(0);
}

// --- Asset Loading (at the beginning of init or its own function) ---
async function loadAssets() {
    const soundLoadPromises = [
        // Replace with your actual sound file paths
        loadSound('eat', 'sounds/eat_food.wav'),      // Example: short blip
        loadSound('enemyDefeat', 'sounds/enemy_die.wav'), // Example: small explosion or crunch
        loadSound('gameOver', 'sounds/game_over_lose.wav'), // Example: sad trombone or explosion
        loadSound('levelUp', 'sounds/size_level_up.wav'),  // Example: positive chime or whoosh
        loadSound('powerUp', 'sounds/powerup_get.wav'),  // Example: sparkling sound
        loadSound('shieldHit', 'sounds/shield_break.wav'), // Example: metallic clank or energy break
        loadSound('uiClick', 'sounds/ui_click.wav'),    // Example: short, soft click
        loadSound('uiConfirm', 'sounds/ui_confirm.wav'), // Example: positive short chime for start button
        loadSound('prestige', 'sounds/prestige_sound.wav'), // Example: grander sound
        loadSound('music', 'sounds/background_music.mp3') // Example: your looping music track
    ];
    await Promise.all(soundLoadPromises);
    // console.log("All sound assets attempted to load.");
    // You might want to enable the start button here if it was disabled during loading
    const startButton = document.getElementById('splash-start-button');
    if (startButton) startButton.disabled = false; // Enable start button after loading
}

// --- Initialization ---
async function init() { // Make init async
    const startButton = document.getElementById('splash-start-button');
    if (startButton) startButton.disabled = true; // Disable start button initially

    await loadAssets(); // Wait for assets to load
    
    loadProgress();
    initThree();
    setupEventListeners(); // Listeners are set up, start button now enabled will trigger audio context resume
    showSplashScreen();
}
init();