(() => {
"use strict";

const SOURCE_BLOCK = 32;
const RENDER_SCALE = 0.5;
const BLOCK = SOURCE_BLOCK * RENDER_SCALE;
const COLS = 40;
const ROWS = 36;
const WIDTH = COLS * BLOCK;
const HEIGHT = ROWS * BLOCK;

const RIVER_X0 = 27;
const RIVER_X1 = 36;
const PLAYER_START = [20, 17];
const FISHERMAN_POS = [12, 11];
const NPC_BASES = ["NPC_boy", "NPC_girl", "NPC_green_girl"];

const NPC_DECISION_PERIOD = 0.75;
const FISH_STEP_PERIOD = 0.30;

const RESTRICTED_AREAS = [
  [[0,0],[3,0],[3,30],[27,30],[27,36],[0,36]],
  [[3,3],[18.7,3],[18.7,14],[3,14]],
  [[3,17],[4.5,17],[4.5,20],[10.8,20],[10.8,27],[6,27],[6,30],[3,30]],
  [[3,0],[18.7,0],[18.7,4],[3,4]],
  [[31.8,7],[37,7],[37,10.5],[31.8,10.5]]
];

const FISH_COLORS = {
  orange: "#f28c28",
  red: "#d94b4b",
  blue: "#4c83c3",
  purple: "#8d61b8",
  yellow: "#e8c94c"
};

const SQUID_COLORS = {
  red: 0.20,
  blue: 0.30,
  purple: 0.01,
  yellow: 0.50
};

const ANTI_CHEAT_CHARACTERS = [
  "魬","𩵩","䰷","䰾","䰼","漁","鮀","䱃",
  "䱈","𩶓","漁","䱉","鯉","鯛","鰻","鯰",
  "鯨","鮪","蝦","蟹","鮙","𩶤","鮥","鮟",
  "鮞","鮝","𩶲","鱘","鮵","鮶","鮷","鮸",
  "鮽","鮾","鮿","鯀","鯁","鯂","鯃","鯄",
  "鯅","鯆","鯇","鯉","鯊","鯋","鯌","鯍",
  "鯎","鯏","鯑","鯒","鯓","鯽","䱏","䱐",
  "䱑","䱒","䱓","䱔","䱕","䱖","䱗","𩷒"
];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
canvas.tabIndex = 0;

const assets = {};
const assetNames = [
  "fish", "dummyfish", "background_boulder",
  "NPC_boy_left","NPC_boy_right",
  "NPC_girl_left","NPC_girl_right",
  "NPC_green_girl_left","NPC_green_girl_right",
  "Player_stand_front","Player_stand_back",
  "Player_stand_left","Player_stand_right",
  "Player_walk_left","Player_walk_right",
  "Player_water_left","Player_water_right",
  "Player_water_front","Player_water_back",
  "fish_orange","fish_red","fish_yellow","fish_blue","fish_purple",
  "Squid_red","Squid_blue","Squid_purple","Squid_yellow"
];

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load resources/" + name + ".png"));
    img.src = "resources/" + name + ".png";
  });
}

async function loadAssets() {
  await Promise.all(assetNames.map(async name => {
    assets[name] = await loadImage(name);
  }));
}

const state = {
  player: [...PLAYER_START],
  playerFacing: "down",
  playerWalkFrame: false,
  fish: null,
  caughtFish: null,
  carriedFish: null,
  score: 0,
  purpleSquidCount: 0,
  yellowFishCaught: false,
  playerInWater: false,
  spawnAttemptAvailable: true,
  worldFrozen: false,
  caughtBy: null,
  npcTimer: 0,
  fishTimer: 0,
  dummyFishMode: false,
  showCollisionDebug: false,
  npcs: []
};

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomChoices(items, weights) {
  let r = Math.random() * weights.reduce((a,b) => a+b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function isInsidePolygon(x, y, polygon) {
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      ((yi > y) !== (yj > y)) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
    j = i;
  }
  return inside;
}

function isRestricted(x, y) {
  const px = x + 0.5;
  const py = y + 0.5;
  return RESTRICTED_AREAS.some(poly => isInsidePolygon(px, py, poly));
}

function generateNPCs() {
  const candidates = [];
  for (let y = 2; y <= ROWS - 3; y++) candidates.push(y);

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const ys = [];
  for (const y of candidates) {
    if (ys.every(oldY => Math.abs(y - oldY) >= 6)) ys.push(y);
    if (ys.length === 3) break;
  }
  ys.sort((a,b) => a-b);

  state.npcs = ys.map((y, i) => ({
    x: Math.floor(Math.random() * (RIVER_X1 - RIVER_X0 + 1)) + RIVER_X0,
    y,
    facing: Math.random() < 0.5 ? -1 : 1,
    state: randomChoice(["still","move","turn"]),
    locked: false,
    base: NPC_BASES[i]
  }));
}

function resetGame() {
  state.player = [...PLAYER_START];
  state.playerFacing = "down";
  state.playerWalkFrame = false;
  state.fish = null;
  state.caughtFish = null;
  state.carriedFish = null;
  state.score = 0;
  state.purpleSquidCount = 0;
  state.yellowFishCaught = false;
  state.playerInWater = false;
  state.spawnAttemptAvailable = true;
  state.worldFrozen = false;
  state.caughtBy = null;
  state.npcTimer = 0;
  state.fishTimer = 0;
  generateNPCs();
  draw();
}

function trySpawnFish() {
  if (state.fish || state.caughtFish || state.carriedFish) return false;

  const highest = Math.min(...state.npcs.map(n => n.y));
  const lowest = Math.max(...state.npcs.map(n => n.y));
  if (!(highest <= state.player[1] && state.player[1] <= lowest)) return false;

  const x = Math.floor(Math.random() * (RIVER_X1 - RIVER_X0 + 1)) + RIVER_X0;
  const kind = state.yellowFishCaught ? randomChoice(["fish","squid"]) : "fish";

  state.fish = {x, y: 0, kind};
  state.fishTimer = 0;
  return true;
}

function getFishProbabilities() {
  const x = state.score;

  const orange = Math.max(0.25 - 0.005 * x, 0);
  const blue = 0.10;
  const purple = Math.max(
    0.90 * Math.sin((x * Math.PI) / 15) - 0.20 - 0.01 * x,
    0
  );
  const yellow = Math.min(0.0014 * x * Math.sqrt(x), 0.5);
  const red = Math.max(
    1.0 - orange - blue - purple - yellow,
    0
  );

  return {
    orange,
    blue,
    purple,
    yellow,
    red
  };
}

function chooseFishColor() {
  const probabilities = getFishProbabilities();

  const names = ["orange","blue","purple","yellow","red"];
  const weights = [
    probabilities.orange,
    probabilities.blue,
    probabilities.purple,
    probabilities.yellow,
    probabilities.red
  ];

  const total = weights.reduce((a,b) => a + b, 0);

  let r = Math.random() * total;

  for (let i = 0; i < names.length; i++) {
    r -= weights[i];

    if (r <= 0) {
      return [names[i], FISH_COLORS[names[i]]];
    }
  }

  return ["red", FISH_COLORS.red];
}

function getSquidProbabilities() {
  return {
    red: 0.20,
    blue: 0.30,
    purple: 0.01,
    yellow: 0.50
  };
}

function chooseSquidColor() {
  const probabilities = getSquidProbabilities();
  const names = Object.keys(probabilities);

  const weights = names.map(name => probabilities[name]);

  let r = Math.random() * weights.reduce((a,b) => a + b, 0);

  for (let i = 0; i < names.length; i++) {
    r -= weights[i];

    if (r <= 0) {
      const name = names[i];
      return [name, FISH_COLORS[name]];
    }
  }

  return ["yellow", FISH_COLORS.yellow];
}

function getAntiCheatCharacter() {
  const fish = getFishProbabilities();
  const squid = getSquidProbabilities();
  const values = [
    Math.round(fish.orange * 1000000),
    Math.round(fish.blue   * 1000000),
    Math.round(fish.purple * 1000000),
    Math.round(fish.yellow * 1000000),
    Math.round(fish.red    * 1000000),

    Math.round(squid.red    * 1000000),
    Math.round(squid.blue   * 1000000),
    Math.round(squid.purple * 1000000),
    Math.round(squid.yellow * 1000000)
  ];

  let hash = 2166136261;

  for (const value of values) {
    hash ^= value & 0xffffffff;
    hash = Math.imul(hash, 16777619);
  }

  hash >>>= 0;

  const index = hash % ANTI_CHEAT_CHARACTERS.length;

  return ANTI_CHEAT_CHARACTERS[index];
}

function checkAllCatches() {
  if (!state.fish || state.worldFrozen) return;
  const {x: fx, y: fy} = state.fish;

  for (const npc of state.npcs) {
    if (fy === npc.y && fx === npc.x + npc.facing) {
      catchFish(fx, fy, "NPC");
      return;
    }
  }
  checkPlayerFrontCatch();
}

function checkPlayerFrontCatch() {
  if (!state.fish || state.worldFrozen) return;
  const {x: fx, y: fy} = state.fish;
  const [px, py] = state.player;

  const front =
    (state.playerFacing === "left"  && fy === py && fx === px - 1) ||
    (state.playerFacing === "right" && fy === py && fx === px + 1) ||
    (state.playerFacing === "up"    && fx === px && fy === py - 1) ||
    (state.playerFacing === "down"  && fx === px && fy === py + 1);

  if (front) catchFish(fx, fy, "PLAYER");
}

function catchFish(x, y, caughtBy) {
  if (!state.fish) return;

  const kind = state.fish.kind || "fish";
  let name, color;

  if (kind === "squid") {
      [name, color] = chooseSquidColor();
  } else {
      [name, color] = chooseFishColor();

      if (name === "yellow") {
          state.yellowFishCaught = true;
      }
  }

  const creature = {x, y, kind, color, name};
  state.fish = null;
  state.fishTimer = 0;
  state.caughtBy = caughtBy;

  if (caughtBy === "PLAYER") {
    state.caughtFish = null;
    state.carriedFish = creature;
  } else {
    state.caughtFish = creature;
    state.carriedFish = null;
    state.worldFrozen = true;
  }
}

function tryDeliverFish() {
  if (!state.carriedFish) return;

  const [fx, fy] = FISHERMAN_POS;

  if (
    Math.abs(state.player[0] - fx) <= 1 &&
    Math.abs(state.player[1] - fy) <= 3
  ) {
  if (
    state.carriedFish.kind === "squid" &&
    state.carriedFish.name === "purple"
  ) {
    state.purpleSquidCount += 1;
}

    state.carriedFish = null;
    state.caughtBy = null;
    state.score += 1;
    state.playerInWater = false;
    state.spawnAttemptAvailable = true;
  }
}

function checkFishBottom() {
  if (state.fish && state.fish.y >= ROWS) {
    state.fish = null;
    state.fishTimer = 0;
    if (state.playerInWater && !state.caughtFish && !state.carriedFish) {
      trySpawnFish();
    }
  }
}

function movePlayer(dx, dy) {
  if (state.worldFrozen) return;

  const nx = Math.max(0, Math.min(COLS-1, state.player[0] + dx));
  const ny = Math.max(0, Math.min(ROWS-1, state.player[1] + dy));

  if (isRestricted(nx, ny)) return;

  if (dx < 0) state.playerFacing = "left";
  else if (dx > 0) state.playerFacing = "right";
  else if (dy < 0) state.playerFacing = "up";
  else if (dy > 0) state.playerFacing = "down";

  state.playerWalkFrame = !state.playerWalkFrame;

  if (state.fish && state.fish.x === nx && state.fish.y === ny) {
    state.player = [nx, ny];
    catchFish(state.fish.x, state.fish.y, "PLAYER");
    draw();
    return;
  }

  state.player = [nx, ny];

  const inWater = nx >= RIVER_X0;
  if (inWater !== state.playerInWater) state.playerWalkFrame = false;

  if (!inWater && state.playerInWater) {
    state.playerInWater = false;
    state.spawnAttemptAvailable = true;
  }

  if (inWater && !state.playerInWater) {
    state.playerInWater = true;
    state.spawnAttemptAvailable = false;
    if (!state.fish && !state.caughtFish && !state.carriedFish) trySpawnFish();
  }

  checkPlayerFrontCatch();
  tryDeliverFish();
  draw();
}

function updateNPCs() {
  for (const npc of state.npcs) {
    const chosenState = randomChoices(
      ["still","move","turn"], [0.50,0.32,0.18]
    );

    if (!state.fish) {
      npc.locked = false;
      npc.state = chosenState;
    } else {
      const fx = state.fish.x;
      const lookingTowardFish =
        (npc.x < fx && npc.facing === 1) ||
        (npc.x > fx && npc.facing === -1);

      if (!npc.locked && lookingTowardFish) npc.locked = true;
      npc.state = chosenState;

      if (npc.locked) {
        if (npc.x < fx) npc.facing = 1;
        else if (npc.x > fx) npc.facing = -1;
      }
    }

    checkAllCatches();
    if (state.worldFrozen) break;

    if (npc.state === "turn") {
      if (!npc.locked) npc.facing *= -1;
    } else if (npc.state === "move") {
      let nx = npc.x + npc.facing;
      if (RIVER_X0 <= nx && nx <= RIVER_X1) {
        npc.x = nx;
      } else {
        npc.facing *= -1;
        nx = npc.x + npc.facing;
        if (RIVER_X0 <= nx && nx <= RIVER_X1) npc.x = nx;
      }
    }

    if (npc.locked && state.fish) {
      const fx = state.fish.x;
      const crossed =
        (npc.facing === 1 && npc.x >= fx) ||
        (npc.facing === -1 && npc.x <= fx);
      if (crossed) npc.locked = false;
    }

    checkAllCatches();
    if (state.worldFrozen) break;
  }
}

function drawSpriteCentered(img, cx, cy, yOffset=0) {
  const x = cx * BLOCK + BLOCK/2;
  const y = cy * BLOCK + BLOCK/2 + yOffset * RENDER_SCALE;
  ctx.drawImage(
    img,
    x - img.naturalWidth * RENDER_SCALE / 2,
    y - img.naturalHeight * RENDER_SCALE / 2,
    img.naturalWidth * RENDER_SCALE,
    img.naturalHeight * RENDER_SCALE
  );
}

function creatureImage(creature) {
  if (creature.kind === "squid") {
    const name = ["red","blue","purple","yellow"].includes(creature.name)
      ? creature.name : "red";
    return assets["Squid_" + name];
  }
  const name = ["orange","red","yellow","blue","purple"].includes(creature.name)
    ? creature.name : "orange";
  return assets["fish_" + name];
}

function drawNPCs() {
  for (const npc of state.npcs) {
    const direction = npc.facing > 0 ? "right" : "left";
    drawSpriteCentered(
      assets[`${npc.base}_${direction}`],
      npc.x, npc.y, 4
    );
  }
}

function drawFish() {
  if (state.fish) {
    const fishImage = state.dummyFishMode
      ? assets.dummyfish
      : assets.fish;

    drawSpriteCentered(
      fishImage,
      state.fish.x,
      state.fish.y
    );
  }

  if (state.caughtFish) {
    drawSpriteCentered(
      creatureImage(state.caughtFish),
      state.caughtFish.x,
      state.caughtFish.y
    );
  }

  if (state.carriedFish) {
    drawSpriteCentered(
      creatureImage(state.carriedFish),
      state.player[0],
      state.player[1]
    );
  }
}

function drawPlayer() {
  const inWater = state.player[0] >= RIVER_X0;
  let spriteName;

  if (inWater) {
    spriteName = {
      left: "Player_water_left",
      right: "Player_water_right",
      up: "Player_water_back",
      down: "Player_water_front"
    }[state.playerFacing];
  } else if (
    (state.playerFacing === "left" || state.playerFacing === "right") &&
    state.playerWalkFrame
  ) {
    spriteName = "Player_walk_" + state.playerFacing;
  } else {
    spriteName = {
      left: "Player_stand_left",
      right: "Player_stand_right",
      up: "Player_stand_back",
      down: "Player_stand_front"
    }[state.playerFacing];
  }

  drawSpriteCentered(assets[spriteName], state.player[0], state.player[1]);
}

function roundedRect(x1,y1,x2,y2,r,fill,outline,width=3) {
  ctx.beginPath();
  ctx.moveTo(x1+r,y1);
  ctx.lineTo(x2-r,y1);
  ctx.quadraticCurveTo(x2,y1,x2,y1+r);
  ctx.lineTo(x2,y2-r);
  ctx.quadraticCurveTo(x2,y2,x2-r,y2);
  ctx.lineTo(x1+r,y2);
  ctx.quadraticCurveTo(x1,y2,x1,y2-r);
  ctx.lineTo(x1,y1+r);
  ctx.quadraticCurveTo(x1,y1,x1+r,y1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function drawHUD() {
  roundedRect(17,12,152,52,9,"#f7f2df","#43506c",2);

  ctx.fillStyle = "#303047";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText(`魚 ${state.score}`, 84.5, 32);

  const x1=14, y1=511, x2=118, y2=552;

  roundedRect(
    x1+2.5,y1+3,x2+2.5,y2+3,
    6,
    "#744b2d",
    "#744b2d",
    1
  );

  const buttonColor =
    state.worldFrozen ? "#f6a52f" : "#bdbdbd";

  roundedRect(
    x1,y1,x2,y2,
    6,
    buttonColor,
    "#fff0c8",
    2
  );

  ctx.fillStyle = "#30251e";
  ctx.font = "bold 15px sans-serif";

  ctx.fillText(
    "重新開始",
    (x1+x2)/2,
    (y1+y2)/2
  );

  roundedRect(
    157, 12, 292, 52,
    9,
    "#f7f2df",
    "#43506c",
    2
  );

  ctx.fillStyle = "#303047";
  ctx.font = "bold 18px sans-serif";

  ctx.fillText(
    `金魚 ${state.purpleSquidCount}`,
    224.5,
    32
  );

	const antiCheatChar = getAntiCheatCharacter();

	ctx.beginPath();
	ctx.arc(582, 537, 25, 0, Math.PI * 2);
	ctx.fillStyle = "#f7f2df";
	ctx.fill();
	ctx.strokeStyle = "#43506c";
	ctx.lineWidth = 2;
	ctx.stroke();

	ctx.fillStyle = "#303047";
	ctx.font = "bold 23px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	ctx.fillText(
	  antiCheatChar,
	  582,
	  537
	);

  if (state.worldFrozen) {
    const boxWidth =
      640 -
      RIVER_X0 * SOURCE_BLOCK * RENDER_SCALE -
      20;

    const boxHeight = 35;

    const bx1 = 320 - boxWidth/2;
    const bx2 = 320 + boxWidth/2;
    const by1 = 288 - boxHeight/2;
    const by2 = 288 + boxHeight/2;

    roundedRect(
      bx1,by1,bx2,by2,
      6,
      "#f7f2df",
      "#a95035",
      1.5
    );

    ctx.fillStyle = "#a95035";
    ctx.font = "bold 15px sans-serif";

    ctx.fillText(
      "抓到魚了!",
      320,
      288
    );
  }

  if (state.carriedFish) {
    roundedRect(
      215,538,425,559,
      5,
      "#f7f2df",
      "#4d5b67",
      1
    );

    ctx.fillStyle = "#2e2a27";
    ctx.font = "bold 15px sans-serif";

    ctx.fillText(
      "「把魚帶到市場攤位」",
      320,
      548.5
    );
  }
}

function drawCollisionDebug() {
  if (!state.showCollisionDebug) return;
  for (const polygon of RESTRICTED_AREAS) {
    ctx.beginPath();
    polygon.forEach(([x,y], i) => {
      const px=x*BLOCK, py=y*BLOCK;
      if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    });
    ctx.closePath();
    ctx.fillStyle="rgba(255,0,0,0.25)";
    ctx.fill();
    ctx.strokeStyle="#ff0000";
    ctx.lineWidth=1;
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0,0,WIDTH,HEIGHT);
  ctx.drawImage(assets.background_boulder,0,0,WIDTH,HEIGHT);
  drawCollisionDebug();
  drawNPCs();
  drawPlayer();
  drawFish();
  drawHUD();
}

let lastTime = performance.now();

function tick(now) {
  const dt = Math.min((now-lastTime)/1000, 0.10);
  lastTime = now;

  if (!state.worldFrozen) {
    state.npcTimer += dt;
    state.fishTimer += dt;

    while (state.npcTimer >= NPC_DECISION_PERIOD) {
      state.npcTimer -= NPC_DECISION_PERIOD;
      updateNPCs();
    }

    checkPlayerFrontCatch();

    while (state.fish && state.fishTimer >= FISH_STEP_PERIOD) {
      state.fishTimer -= FISH_STEP_PERIOD;
      state.fish.y += 1;
      checkFishBottom();
      if (state.fish) checkAllCatches();
    }
  }

  draw();
  requestAnimationFrame(tick);
}

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (["arrowleft","arrowright","arrowup","arrowdown"," ","w","a","s","d","r","f1","f3"].includes(key)) {
    event.preventDefault();
  }

  if (key === "f1") {
    state.dummyFishMode = !state.dummyFishMode;
    draw();
    return;
  }

  if (key === "f3") {
    state.showCollisionDebug = !state.showCollisionDebug;
    draw();
    return;
  }

  if (key === "r") {
    resetGame();
    return;
  }

  const moves = {
    arrowleft: [-1,0], a: [-1,0],
    arrowright: [1,0], d: [1,0],
    arrowup: [0,-1], w: [0,-1],
    arrowdown: [0,1], s: [0,1]
  };

  if (moves[key]) movePlayer(...moves[key]);
});

canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;

  if (x >= 14 && x <= 118 && y >= 511 && y <= 552) {
    resetGame();
  }
});

(async () => {
  try {
    await loadAssets();
    resetGame();
    requestAnimationFrame(tick);
    canvas.focus();
  } catch (error) {
    console.error(error);
    document.body.innerHTML =
      `<pre style="color:white;padding:2rem;font:16px sans-serif">${error.message}</pre>`;
  }
})();
})();
