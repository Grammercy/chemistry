const stage = document.querySelector(".reaction-stage");
const particleLayer = document.getElementById("particle-layer");
const overlay = document.getElementById("force-overlay");

const controls = {
  concentration: document.getElementById("concentration"),
  dissociation: document.getElementById("dissociation"),
  temperature: document.getElementById("temperature"),
  speed: document.getElementById("speed"),
  polarity: document.getElementById("polarity"),
  density: document.getElementById("density"),
};

const outputs = {
  concentration: document.getElementById("concentration-value"),
  dissociation: document.getElementById("dissociation-value"),
  temperature: document.getElementById("temperature-value"),
  speed: document.getElementById("speed-value"),
  polarity: document.getElementById("polarity-value"),
  density: document.getElementById("density-value"),
  ph: document.getElementById("ph-value"),
  acidRemaining: document.getElementById("acid-remaining"),
  acetate: document.getElementById("acetate-value"),
  hydronium: document.getElementById("hydronium-value"),
  equilibrium: document.getElementById("equilibrium-caption"),
  speciesCounts: document.getElementById("species-counts"),
};

const PARTICLE_LABELS = {
  acid: "CH3COOH",
  water: "H2O",
  acetate: "CH3COO-",
  hydronium: "H3O+",
};

const PARTICLE_SIZE = {
  acid: 54,
  water: 40,
  acetate: 46,
  hydronium: 46,
};

const WALL_PADDING = 12;
const REACTION_COOLDOWN_MS = 260;
const CONTACT_COOLDOWN_MS = 100;

let particles = [];
let lastTimestamp = 0;
let initialized = false;

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMolarity(value) {
  return `${value.toFixed(3)} M`;
}

function describeLevel(value) {
  if (value >= 82) {
    return "Very high";
  }
  if (value >= 62) {
    return "High";
  }
  if (value >= 40) {
    return "Moderate";
  }
  if (value >= 20) {
    return "Low";
  }
  return "Very low";
}

function getState() {
  return {
    concentration: Number(controls.concentration.value),
    dissociation: Number(controls.dissociation.value) / 100,
    temperature: Number(controls.temperature.value),
    speed: Number(controls.speed.value),
    polarity: Number(controls.polarity.value),
    density: Number(controls.density.value),
  };
}

function getStageBounds() {
  const { width, height } = stage.getBoundingClientRect();
  return { width, height };
}

function getTargetPopulation(state) {
  return {
    acidUnits: Math.max(
      10,
      Math.round(state.density * (0.35 + state.concentration / 2.8)),
    ),
    solventUnits: Math.max(
      16,
      Math.round(state.density * (0.7 + state.polarity / 180)),
    ),
  };
}

function countParticles() {
  const counts = {
    acid: 0,
    water: 0,
    acetate: 0,
    hydronium: 0,
  };

  for (const particle of particles) {
    counts[particle.type] += 1;
  }

  return counts;
}

function getIonFraction(counts) {
  const acidPool = counts.acid + counts.acetate;
  if (acidPool === 0) {
    return 0;
  }

  return counts.acetate / acidPool;
}

function computeSpecies(state, counts = countParticles()) {
  const acidPool = counts.acid + counts.acetate;
  const concentrationPerAcidUnit = acidPool > 0 ? state.concentration / acidPool : 0;
  const acetateMolarity = counts.acetate * concentrationPerAcidUnit;
  const acidRemainingMolarity = counts.acid * concentrationPerAcidUnit;
  const hydroniumMolarity = counts.hydronium * concentrationPerAcidUnit;
  const actualDissociation = getIonFraction(counts);
  const ph = -Math.log10(Math.max(hydroniumMolarity, 1e-7));

  return {
    neutralAcidCount: counts.acid,
    acetateCount: counts.acetate,
    hydroniumCount: counts.hydronium,
    waterCount: counts.water,
    acidRemainingMolarity,
    acetateMolarity,
    hydroniumMolarity,
    actualDissociation,
    ph,
  };
}

function setParticleType(particle, type) {
  particle.type = type;
  particle.size = PARTICLE_SIZE[type];
  particle.reactionCooldown = REACTION_COOLDOWN_MS;
  particle.element.className = `particle ${type}`;
  particle.element.style.width = `${particle.size}px`;
  particle.element.style.height = `${particle.size}px`;
  particle.element.innerHTML = `<span>${PARTICLE_LABELS[type]}</span>`;
}

function createParticle(type, width, height, temperature) {
  const size = PARTICLE_SIZE[type];
  const padding = size / 2 + 20;
  const particle = {
    id: `${type}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    size,
    x: randomInRange(padding, width - padding),
    y: randomInRange(padding, height - padding),
    vx: randomInRange(-0.13, 0.13) * (1 + temperature / 55),
    vy: randomInRange(-0.13, 0.13) * (1 + temperature / 55),
    reactionCooldown: randomInRange(0, CONTACT_COOLDOWN_MS),
    element: document.createElement("div"),
  };

  setParticleType(particle, type);
  particle.reactionCooldown = randomInRange(0, CONTACT_COOLDOWN_MS);
  return particle;
}

function confineParticle(particle, width, height) {
  const padding = particle.size / 2 + WALL_PADDING;
  particle.x = clamp(particle.x, padding, width - padding);
  particle.y = clamp(particle.y, padding, height - padding);
}

function addParticle(type, state) {
  const { width, height } = getStageBounds();
  const particle = createParticle(type, width, height, state.temperature);
  particles.push(particle);
  particleLayer.appendChild(particle.element);
  return particle;
}

function removeParticle(particle) {
  const index = particles.indexOf(particle);
  if (index >= 0) {
    particles.splice(index, 1);
  }

  particle.element.remove();
}

function pickParticle(type) {
  const matches = particles.filter((particle) => particle.type === type);
  if (matches.length === 0) {
    return null;
  }

  return matches[Math.floor(Math.random() * matches.length)];
}

function resetSimulation(state) {
  particleLayer.replaceChildren();
  particles = [];

  const { width, height } = getStageBounds();
  const targets = getTargetPopulation(state);
  const seededIonPairs = clamp(
    Math.round(targets.acidUnits * state.dissociation),
    state.dissociation > 0 ? 1 : 0,
    Math.min(targets.acidUnits - 1, targets.solventUnits - 1),
  );

  for (let index = 0; index < targets.solventUnits - seededIonPairs; index += 1) {
    particles.push(createParticle("water", width, height, state.temperature));
  }

  for (let index = 0; index < targets.acidUnits - seededIonPairs; index += 1) {
    particles.push(createParticle("acid", width, height, state.temperature));
  }

  for (let index = 0; index < seededIonPairs; index += 1) {
    particles.push(createParticle("acetate", width, height, state.temperature));
    particles.push(createParticle("hydronium", width, height, state.temperature));
  }

  const fragment = document.createDocumentFragment();
  for (const particle of particles) {
    fragment.appendChild(particle.element);
  }
  particleLayer.appendChild(fragment);
  initialized = true;
}

function syncPopulationTargets(state) {
  if (!initialized) {
    resetSimulation(state);
    return;
  }

  const targets = getTargetPopulation(state);
  let counts = countParticles();

  while (counts.acid + counts.acetate < targets.acidUnits) {
    addParticle("acid", state);
    counts.acid += 1;
  }

  while (counts.acid + counts.acetate > targets.acidUnits) {
    const neutralAcid = pickParticle("acid");
    if (neutralAcid) {
      removeParticle(neutralAcid);
      counts.acid -= 1;
      continue;
    }

    const acetate = pickParticle("acetate");
    if (!acetate) {
      break;
    }

    removeParticle(acetate);
    counts.acetate -= 1;

    const hydronium = pickParticle("hydronium");
    if (hydronium) {
      setParticleType(hydronium, "water");
      counts.hydronium -= 1;
      counts.water += 1;
    }
  }

  counts = countParticles();

  while (counts.water + counts.hydronium < targets.solventUnits) {
    addParticle("water", state);
    counts.water += 1;
  }

  while (counts.water + counts.hydronium > targets.solventUnits) {
    const water = pickParticle("water");
    if (water) {
      removeParticle(water);
      counts.water -= 1;
      continue;
    }

    const hydronium = pickParticle("hydronium");
    if (!hydronium) {
      break;
    }

    removeParticle(hydronium);
    counts.hydronium -= 1;

    const acetate = pickParticle("acetate");
    if (acetate) {
      setParticleType(acetate, "acid");
      counts.acetate -= 1;
      counts.acid += 1;
    }
  }

  const { width, height } = getStageBounds();
  for (const particle of particles) {
    confineParticle(particle, width, height);
  }
}

function getReactionChances(state, counts, impactFactor) {
  const currentDissociation = getIonFraction(counts);
  const forwardBias = clamp((state.dissociation - currentDissociation) * 3, -1, 1);
  const reverseBias = clamp((currentDissociation - state.dissociation) * 3, -1, 1);

  const forwardChance = clamp(
    (
      0.015 +
      state.dissociation * 0.12 +
      Math.max(0, forwardBias) * 0.18 +
      state.temperature / 5000 +
      state.polarity / 6000
    ) * impactFactor,
    0.01,
    0.32,
  );

  const reverseChance = clamp(
    (
      0.06 +
      (1 - state.dissociation) * 0.16 +
      Math.max(0, reverseBias) * 0.24 +
      (100 - state.temperature) / 7000
    ) * (0.75 + impactFactor * 0.25),
    0.03,
    0.46,
  );

  return { forwardChance, reverseChance };
}

function kickApart(a, b, nx, ny, strength) {
  a.vx -= nx * strength;
  a.vy -= ny * strength;
  b.vx += nx * strength;
  b.vy += ny * strength;
}

function attemptReaction(a, b, state, counts, nx, ny) {
  if (a.reactionCooldown > 0 || b.reactionCooldown > 0) {
    return;
  }

  const impactFactor = clamp(
    Math.hypot(a.vx - b.vx, a.vy - b.vy) / 0.45,
    0.45,
    1.5,
  );
  const { forwardChance, reverseChance } = getReactionChances(state, counts, impactFactor);
  const pair = `${a.type}:${b.type}`;

  if (pair === "acid:water" || pair === "water:acid") {
    if (Math.random() < forwardChance) {
      const acidParticle = a.type === "acid" ? a : b;
      const waterParticle = acidParticle === a ? b : a;
      setParticleType(acidParticle, "acetate");
      setParticleType(waterParticle, "hydronium");
      counts.acid -= 1;
      counts.water -= 1;
      counts.acetate += 1;
      counts.hydronium += 1;
      kickApart(acidParticle, waterParticle, nx, ny, 0.18);
      return;
    }

    a.reactionCooldown = CONTACT_COOLDOWN_MS;
    b.reactionCooldown = CONTACT_COOLDOWN_MS;
    return;
  }

  if (pair === "acetate:hydronium" || pair === "hydronium:acetate") {
    if (Math.random() < reverseChance) {
      const acetateParticle = a.type === "acetate" ? a : b;
      const hydroniumParticle = acetateParticle === a ? b : a;
      setParticleType(acetateParticle, "acid");
      setParticleType(hydroniumParticle, "water");
      counts.acetate -= 1;
      counts.hydronium -= 1;
      counts.acid += 1;
      counts.water += 1;
      kickApart(acetateParticle, hydroniumParticle, nx, ny, 0.14);
      return;
    }

    a.reactionCooldown = CONTACT_COOLDOWN_MS;
    b.reactionCooldown = CONTACT_COOLDOWN_MS;
  }
}

function resolveCollision(a, b, nx, ny) {
  const relativeVx = b.vx - a.vx;
  const relativeVy = b.vy - a.vy;
  const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

  if (velocityAlongNormal > 0) {
    return;
  }

  const restitution = 0.92;
  const massA = a.size;
  const massB = b.size;
  const impulse =
    (-(1 + restitution) * velocityAlongNormal) /
    ((1 / massA) + (1 / massB));

  a.vx -= (impulse * nx) / massA;
  a.vy -= (impulse * ny) / massA;
  b.vx += (impulse * nx) / massB;
  b.vy += (impulse * ny) / massB;
}

function handleParticleCollisions(state, counts) {
  for (let first = 0; first < particles.length; first += 1) {
    const a = particles[first];

    for (let second = first + 1; second < particles.length; second += 1) {
      const b = particles[second];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minimumDistance = (a.size + b.size) / 2;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared >= minimumDistance * minimumDistance) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared) || 0.0001;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minimumDistance - distance;

      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      resolveCollision(a, b, nx, ny);
      attemptReaction(a, b, state, counts, nx, ny);
    }
  }
}

function updateOutputs(state, species) {
  outputs.concentration.textContent = `${state.concentration.toFixed(2)} M`;
  outputs.dissociation.textContent = `${(state.dissociation * 100).toFixed(1)}% target`;
  outputs.temperature.textContent = `${state.temperature.toFixed(0)} °C`;
  outputs.speed.textContent = `${state.speed.toFixed(2)}x`;
  outputs.polarity.textContent = `${state.polarity.toFixed(0)}%`;
  outputs.density.textContent = `${state.density.toFixed(0)}`;

  outputs.ph.textContent = species.ph.toFixed(2);
  outputs.acidRemaining.textContent = formatMolarity(species.acidRemainingMolarity);
  outputs.acetate.textContent = formatMolarity(species.acetateMolarity);
  outputs.hydronium.textContent = formatMolarity(species.hydroniumMolarity);

  const actualPercent = species.actualDissociation * 100;
  outputs.speciesCounts.textContent =
    `${species.waterCount} water molecules, ${species.neutralAcidCount} CH3COOH molecules, ` +
    `${species.acetateCount} acetate ions, and ${species.hydroniumCount} hydronium ions are shown.`;

  if (actualPercent < state.dissociation * 100 - 1.2) {
    outputs.equilibrium.textContent =
      `Collision-driven ionization is ${actualPercent.toFixed(1)}%, still below the ` +
      `${(state.dissociation * 100).toFixed(1)}% target. More acid-water impacts should dissociate soon.`;
  } else if (actualPercent > state.dissociation * 100 + 1.2) {
    outputs.equilibrium.textContent =
      `Collision-driven ionization is ${actualPercent.toFixed(1)}%, above the ` +
      `${(state.dissociation * 100).toFixed(1)}% target. Acetate and hydronium collisions are recombining the system.`;
  } else {
    outputs.equilibrium.textContent =
      `Collision-driven ionization is ${actualPercent.toFixed(1)}%, close to the ` +
      `${(state.dissociation * 100).toFixed(1)}% target equilibrium.`;
  }
}

function interactionBase(firstType, secondType, state, species) {
  const pair = [firstType, secondType].sort().join(":");

  switch (pair) {
    case "acid:water":
      return 0.7 + state.polarity / 210;
    case "acid:acid":
      return 0.2 + state.concentration / 4;
    case "acetate:hydronium":
      return 1.15 + species.actualDissociation * 0.9;
    case "acetate:water":
    case "hydronium:water":
      return 0.55 + state.polarity / 170;
    case "water:water":
      return 0.12 + state.polarity / 420;
    case "acetate:acetate":
    case "hydronium:hydronium":
      return -1.1;
    case "acetate:acid":
      return 0.28;
    case "acid:hydronium":
      return 0.34;
    default:
      return 0;
  }
}

function getInteractionScore(a, b, state, species) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const maxReach = 240;

  if (distance === 0 || distance > maxReach) {
    return null;
  }

  const distanceWeight = Math.pow(clamp(1 - distance / maxReach, 0, 1), 1.35);
  const base = interactionBase(a.type, b.type, state, species);
  const score = base * distanceWeight;

  if (Math.abs(score) < 0.08) {
    return null;
  }

  return { distance, score };
}

function gradientStops(score, intensity) {
  if (score >= 0) {
    return {
      startColor: "rgb(255, 241, 221)",
      endColor: "rgb(216, 108, 63)",
      startOpacity: 0.2 + intensity * 0.32,
      endOpacity: 0.56 + intensity * 0.38,
    };
  }

  return {
    startColor: "rgb(220, 236, 255)",
    endColor: "rgb(71, 131, 232)",
    startOpacity: 0.2 + intensity * 0.32,
    endOpacity: 0.56 + intensity * 0.38,
  };
}

function makeGradientLine(a, b, score, index) {
  const intensity = clamp(Math.abs(score), 0, 1);
  const gradientId = `force-gradient-${index}`;
  const colors = gradientStops(score, intensity);
  const width = 1.4 + intensity * 3.1;
  const opacity = 0.28 + intensity * 0.62;
  const dasharray = score >= 0 ? "" : "8 8";
  const lineClass = score >= 0 ? "attraction" : "repulsion";

  const gradient = `
    <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse"
      x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}"
      x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}">
      <stop offset="0%" stop-color="${colors.startColor}" stop-opacity="${colors.startOpacity.toFixed(2)}"></stop>
      <stop offset="100%" stop-color="${colors.endColor}" stop-opacity="${colors.endOpacity.toFixed(2)}"></stop>
    </linearGradient>
  `;

  const line = `
    <line class="force-link ${lineClass}"
      x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}"
      x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"
      stroke="url(#${gradientId})"
      stroke-width="${width.toFixed(2)}"
      stroke-opacity="${opacity.toFixed(2)}"
      stroke-dasharray="${dasharray}"></line>
  `;

  return { gradient, line };
}

function drawForceLinks(state, species) {
  const stageRect = stage.getBoundingClientRect();
  overlay.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);

  const gradients = [];
  const lines = [];
  const seenPairs = new Set();

  particles.forEach((particle, index) => {
    let bestInteraction = null;

    for (const candidate of particles) {
      if (candidate === particle) {
        continue;
      }

      const interaction = getInteractionScore(particle, candidate, state, species);
      if (!interaction) {
        continue;
      }

      if (!bestInteraction || Math.abs(interaction.score) > Math.abs(bestInteraction.score)) {
        bestInteraction = {
          partner: candidate,
          score: interaction.score,
        };
      }
    }

    if (!bestInteraction) {
      return;
    }

    const pairKey = [particle.id, bestInteraction.partner.id].sort().join(":");
    if (seenPairs.has(pairKey)) {
      return;
    }

    seenPairs.add(pairKey);
    const lineParts = makeGradientLine(
      particle,
      bestInteraction.partner,
      bestInteraction.score,
      index,
    );
    gradients.push(lineParts.gradient);
    lines.push(lineParts.line);
  });

  overlay.innerHTML = gradients.length > 0
    ? `<defs>${gradients.join("")}</defs>${lines.join("")}`
    : "";
}

function tick(timestamp) {
  const delta = lastTimestamp ? timestamp - lastTimestamp : 16;
  lastTimestamp = timestamp;

  const state = getState();
  const stageRect = stage.getBoundingClientRect();
  const speedFactor = (delta / 16) * state.speed;

  for (const particle of particles) {
    const padding = particle.size / 2 + WALL_PADDING;
    particle.reactionCooldown = Math.max(0, particle.reactionCooldown - delta * state.speed);
    particle.x += particle.vx * speedFactor;
    particle.y += particle.vy * speedFactor;

    if (particle.x <= padding || particle.x >= stageRect.width - padding) {
      particle.vx *= -1;
      particle.x = clamp(particle.x, padding, stageRect.width - padding);
    }

    if (particle.y <= padding || particle.y >= stageRect.height - padding) {
      particle.vy *= -1;
      particle.y = clamp(particle.y, padding, stageRect.height - padding);
    }

    const drift = 1 + state.temperature / 55;
    particle.vx += randomInRange(-0.004, 0.004) * drift;
    particle.vy += randomInRange(-0.004, 0.004) * drift;
    particle.vx = clamp(particle.vx, -0.45, 0.45);
    particle.vy = clamp(particle.vy, -0.45, 0.45);
  }

  const counts = countParticles();
  handleParticleCollisions(state, counts);
  const species = computeSpecies(state, counts);

  for (const particle of particles) {
    confineParticle(particle, stageRect.width, stageRect.height);
    particle.element.style.left = `${particle.x}px`;
    particle.element.style.top = `${particle.y}px`;
  }

  updateOutputs(state, species);
  drawForceLinks(state, species);
  requestAnimationFrame(tick);
}

function render() {
  const state = getState();
  syncPopulationTargets(state);
  const species = computeSpecies(state);
  updateOutputs(state, species);
  drawForceLinks(state, species);
}

for (const control of Object.values(controls)) {
  control.addEventListener("input", render);
}

window.addEventListener("resize", render);

render();
requestAnimationFrame(tick);
