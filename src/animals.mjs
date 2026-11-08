// Nova Vita — animals (chickens and cows). Pure-ish helpers; the world owns the state.
import { ANIMALS } from './constants.mjs';
import { clamp, shortId } from './core.mjs';

export function createAnimal({ species, ownerId, buildingId, name, tick = 0 }) {
  const def = ANIMALS[species] || ANIMALS.chicken;
  return {
    id: shortId('ani', 6),
    species,
    name: name || def.label,
    emoji: def.emoji,
    ownerId,
    buildingId,
    happiness: 65,
    fedToday: false,
    productReady: false,
    bornTick: tick,
    careTotal: 0,
  };
}

export function animalsOf(world, agentId) {
  return Object.values(world.animals || {}).filter((a) => a.ownerId === agentId);
}

export function animalsInBuilding(world, buildingId) {
  return Object.values(world.animals || {}).filter((a) => a.buildingId === buildingId);
}

/** Dawn: fed animals produce, hungry ones lose happiness. Returns what happened. */
export function dawnAnimals(world) {
  const results = [];
  for (const animal of Object.values(world.animals || {})) {
    const def = ANIMALS[animal.species] || ANIMALS.chicken;
    const owner = world.agents[animal.ownerId];
    if (owner?.perks?.includes('animal_whisperer')) {
      animal.happiness = clamp(animal.happiness + 2, 0, 100);
    }
    if (animal.fedToday) {
      animal.productReady = true;
      animal.happiness = clamp(animal.happiness + 3, 0, 100);
      results.push({ animal, produced: true, product: def.product });
    } else {
      animal.happiness = clamp(animal.happiness - 8, 0, 100);
      results.push({ animal, produced: false, product: def.product });
    }
    animal.fedToday = false;
  }
  return results;
}

export function animalProduct(species) {
  return (ANIMALS[species] || ANIMALS.chicken).product;
}
