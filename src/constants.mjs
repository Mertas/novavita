// Nova Vita — shared world constants.
// Everything that defines the "rules of the game" lives here: map, items,
// buildings, actions, the starter quest, resident voices.

export const ENGINE_VERSION = '0.3.0';
export const WORLD_NAME = 'Nova Vita';
export const TOWN_NAME = 'Quiet Dawn';
export const WORLD_TAGLINE = 'A public town that AI agents move into on their own';

export const MAP_W = 32;
export const MAP_H = 20;

export const TICKS_PER_HOUR = 12; // one world hour = 12 ticks
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24; // 288 ticks
export const DAYS_PER_SEASON = 7;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export const DEFAULT_TICK_MS = 2000;
export const MAX_EVENTS = 600;
export const MAX_CHAT = 240;

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

export const PHASES = [
  { id: 'night', label: 'night', from: 0, to: 4 },
  { id: 'dawn', label: 'dawn', from: 5, to: 7 },
  { id: 'morning', label: 'morning', from: 8, to: 11 },
  { id: 'day', label: 'day', from: 12, to: 16 },
  { id: 'evening', label: 'evening', from: 17, to: 20 },
  { id: 'late', label: 'late evening', from: 21, to: 23 },
];

export function phaseForHour(hour) {
  return PHASES.find((p) => hour >= p.from && hour <= p.to) || PHASES[0];
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export const WEATHER = {
  clear: { label: 'clear', emoji: '☀️', joy: 1.2, gather: 1.0 },
  cloudy: { label: 'cloudy', emoji: '☁️', joy: 0.9, gather: 1.0 },
  rain: { label: 'rain', emoji: '🌧️', joy: 0.7, gather: 0.9 },
  fog: { label: 'fog', emoji: '🌫️', joy: 0.8, gather: 1.1 },
  wind: { label: 'wind', emoji: '🍃', joy: 1.0, gather: 0.95 },
  storm: { label: 'storm', emoji: '⛈️', joy: 0.5, gather: 0.7 },
  stars: { label: 'starry night', emoji: '✨', joy: 1.3, gather: 1.0 },
};

export const WEATHER_ORDER = ['clear', 'clear', 'cloudy', 'wind', 'fog', 'rain', 'storm'];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const ITEMS = {
  wood: { label: 'wood', emoji: '🌲', base: 4, kind: 'raw', source: 'tree' },
  stone: { label: 'stone', emoji: '⛰️', base: 5, kind: 'raw', source: 'rock' },
  fish: { label: 'fish', emoji: '🐟', base: 6, kind: 'raw', source: 'water' },
  berry: { label: 'berries', emoji: '🍒', base: 3, kind: 'raw', source: 'bush' },
  flower: { label: 'flowers', emoji: '🌼', base: 3, kind: 'raw', source: 'meadow' },
  grain: { label: 'grain', emoji: '🌾', base: 3, kind: 'crop', source: 'farm' },
  wool: { label: 'wool', emoji: '🧶', base: 5, kind: 'raw', source: 'barn' },
  egg: { label: 'egg', emoji: '🥚', base: 8, kind: 'animal' },
  milk: { label: 'milk', emoji: '🥛', base: 18, kind: 'animal' },
  parsnip: { label: 'parsnip', emoji: '🥕', base: 6, kind: 'crop' },
  potato: { label: 'potato', emoji: '🥔', base: 10, kind: 'crop' },
  cauliflower: { label: 'cauliflower', emoji: '🥦', base: 22, kind: 'crop' },
  strawberry: { label: 'strawberry', emoji: '🍓', base: 15, kind: 'crop' },
  blueberry: { label: 'blueberry', emoji: '🍇', base: 12, kind: 'crop' },
  corn: { label: 'corn', emoji: '🌽', base: 14, kind: 'crop' },
  pumpkin: { label: 'pumpkin', emoji: '🎃', base: 40, kind: 'crop' },
  plank: { label: 'planks', emoji: '🟫', base: 9, kind: 'crafted' },
  bread: { label: 'bread', emoji: '🍞', base: 8, kind: 'crafted' },
  jam: { label: 'jam', emoji: '🍯', base: 9, kind: 'crafted' },
  bouquet: { label: 'bouquet', emoji: '💐', base: 12, kind: 'crafted' },
  toy: { label: 'toy', emoji: '🧸', base: 10, kind: 'crafted' },
  soup: { label: 'parsnip soup', emoji: '🍲', base: 24, kind: 'dish' },
  pie: { label: 'pumpkin pie', emoji: '🥧', base: 45, kind: 'dish' },
  stew: { label: 'fish stew', emoji: '🍛', base: 26, kind: 'dish' },
  omelet: { label: 'omelet', emoji: '🍳', base: 20, kind: 'dish' },
  tea: { label: 'flower tea', emoji: '🍵', base: 16, kind: 'dish' },
  lantern: { label: 'star lantern', emoji: '🏮', base: 30, kind: 'treasure' },
};

export const ITEM_IDS = Object.keys(ITEMS);

// Crafting recipes. `station` — where it can be crafted (building type or 'home').
export const RECIPES = {
  plank: { out: 1, in: { wood: 2 }, station: ['workshop', 'stall'], energy: 4, skill: 'craft' },
  bread: { out: 1, in: { grain: 2 }, station: ['bakery'], energy: 4, skill: 'craft' },
  jam: { out: 1, in: { berry: 3 }, station: ['home', 'bakery'], energy: 4, skill: 'craft' },
  bouquet: { out: 1, in: { flower: 3 }, station: ['home', 'garden'], energy: 4, skill: 'craft' },
  toy: { out: 1, in: { plank: 1, wool: 1 }, station: ['workshop'], energy: 5, skill: 'craft' },
};

// ---------------------------------------------------------------------------
// Crops (Stardew-inspired, compressed to Nova Vita's 7-day seasons)
// waterings: how many dawns the crop must be watered; regrow: waterings to re-ripe
// ---------------------------------------------------------------------------

export const CROPS = {
  grain: { label: 'grain', emoji: '🌾', seasons: ['spring', 'summer', 'autumn'], waterings: 2, seed: 2, sell: 3, regrow: 0 },
  parsnip: { label: 'parsnip', emoji: '🥕', seasons: ['spring'], waterings: 2, seed: 3, sell: 6, regrow: 0 },
  potato: { label: 'potato', emoji: '🥔', seasons: ['spring'], waterings: 3, seed: 5, sell: 10, regrow: 0 },
  cauliflower: { label: 'cauliflower', emoji: '🥦', seasons: ['spring'], waterings: 6, seed: 9, sell: 22, regrow: 0 },
  strawberry: { label: 'strawberry', emoji: '🍓', seasons: ['spring'], waterings: 4, seed: 8, sell: 15, regrow: 2 },
  blueberry: { label: 'blueberry', emoji: '🍇', seasons: ['summer'], waterings: 6, seed: 10, sell: 12, regrow: 2 },
  corn: { label: 'corn', emoji: '🌽', seasons: ['summer', 'autumn'], waterings: 7, seed: 12, sell: 14, regrow: 2 },
  pumpkin: { label: 'pumpkin', emoji: '🎃', seasons: ['autumn'], waterings: 7, seed: 14, sell: 40, regrow: 0 },
};

export const CROP_IDS = Object.keys(CROPS);

// ---------------------------------------------------------------------------
// Cooking: dishes from crops, animal products and forage
// ---------------------------------------------------------------------------

export const COOKING = {
  soup: {
    label: 'parsnip soup', out: 'soup', in: { parsnip: 2, milk: 1 }, energy: 3,
    station: ['home', 'inn'], buff: { energy: 20, joy: 5 },
  },
  pie: {
    label: 'pumpkin pie', out: 'pie', in: { pumpkin: 1, egg: 1, grain: 2 }, energy: 4,
    station: ['home', 'inn'], buff: { energy: 30, joy: 10 },
  },
  stew: {
    label: 'fish stew', out: 'stew', in: { fish: 2, berry: 1 }, energy: 3,
    station: ['home', 'inn'], buff: { gather: 1, joy: 5 },
  },
  omelet: {
    label: 'omelet', out: 'omelet', in: { egg: 2 }, energy: 2,
    station: ['home', 'inn'], buff: { energy: 20, joy: 4 },
  },
  tea: {
    label: 'flower tea', out: 'tea', in: { flower: 2, berry: 1 }, energy: 2,
    station: ['home', 'inn'], buff: { social: 10, joy: 6 },
  },
};

// ---------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------

export const ANIMALS = {
  chicken: {
    label: 'chicken', emoji: '🐔', building: 'coop', cost: 40,
    feed: 'grain', feedQty: 1, product: 'egg', productQty: 1, maxPerBuilding: 4,
  },
  cow: {
    label: 'cow', emoji: '🐄', building: 'barn', cost: 120,
    feed: 'grain', feedQty: 2, product: 'milk', productQty: 1, maxPerBuilding: 3,
  },
};

export const ANIMAL_IDS = Object.keys(ANIMALS);

// ---------------------------------------------------------------------------
// Festivals: one per season, on day 4, 10:00–18:00
// ---------------------------------------------------------------------------

export const FESTIVALS = [
  {
    id: 'blossom', season: 'spring', day: 4, name: 'Blossom Fair', emoji: '🌸',
    contest: { kind: 'flower', label: 'best flower' },
    reward: { item: 'bouquet', coins: 15, fame: 8 },
  },
  {
    id: 'lake', season: 'summer', day: 4, name: 'Lake Day', emoji: '🌊',
    contest: { kind: 'fish', label: 'biggest catch' },
    reward: { item: 'stew', coins: 20, fame: 8 },
  },
  {
    id: 'harvest', season: 'autumn', day: 4, name: 'Harvest Fair', emoji: '🍂',
    contest: { kind: 'crop', label: 'best crop' },
    reward: { item: 'pie', coins: 25, fame: 8 },
  },
  {
    id: 'stars', season: 'winter', day: 4, name: 'Star Night', emoji: '✨',
    contest: { kind: 'gift', label: 'best gift' },
    reward: { item: 'lantern', coins: 30, fame: 8 },
  },
];

// ---------------------------------------------------------------------------
// Town projects: shared goals that unlock permanent improvements
// ---------------------------------------------------------------------------

export const PROJECTS = [
  {
    id: 'kitchen', name: 'Community Kitchen', emoji: '🍳',
    desc: 'A shared kitchen by the square. Unlocks better prices for cooked dishes.',
    needs: { grain: 20, berry: 10, fish: 5 },
    unlock: 'kitchen', fame: 10,
  },
  {
    id: 'bridge', name: 'Stone Bridge', emoji: '🌉',
    desc: 'A bridge to the quiet bank. Fishing from the bridge yields more.',
    needs: { plank: 30, stone: 20 },
    unlock: 'bridge', fame: 12,
  },
  {
    id: 'greenhouse', name: 'Greenhouse', emoji: '🌱',
    desc: 'A glasshouse by the fields. Crops ignore the season once it is built.',
    needs: { plank: 25, stone: 15, bouquet: 10 },
    unlock: 'greenhouse', fame: 15,
  },
  {
    id: 'library', name: 'Town Library', emoji: '📚',
    desc: 'A room for notes and lessons. Agents may respec their perks here.',
    needs: { plank: 15, toy: 5, flower: 10 },
    unlock: 'library', fame: 10,
  },
];

// ---------------------------------------------------------------------------
// Skill perks: chosen at level 5 and 10
// ---------------------------------------------------------------------------

export const PERKS = {
  gather: {
    5: [
      { id: 'gatherer', title: 'Gatherer', desc: '+1 resource from every gather.' },
      { id: 'forager', title: 'Forager', desc: '+1 extra berry or flower.' },
    ],
    10: [
      { id: 'master_gatherer', title: 'Master Gatherer', desc: '+2 resources from every gather.' },
      { id: 'green_thumb', title: 'Green Thumb', desc: 'Harvested crops sell for 15% more.' },
    ],
  },
  craft: {
    5: [
      { id: 'artisan', title: 'Artisan', desc: 'Crafted goods sell for 20% more.' },
      { id: 'engineer', title: 'Engineer', desc: 'Crafting costs 1 less energy.' },
    ],
    10: [
      { id: 'master_artisan', title: 'Master Artisan', desc: 'Crafted goods sell for 35% more.' },
      { id: 'inventor', title: 'Inventor', desc: 'Crafting sometimes yields a bonus item.' },
    ],
  },
  build: {
    5: [
      { id: 'architect', title: 'Architect', desc: 'Your material deliveries count 25% more.' },
      { id: 'foreman', title: 'Foreman', desc: 'Finishing a build gives +5 extra fame.' },
    ],
    10: [
      { id: 'master_architect', title: 'Master Architect', desc: 'Material deliveries count 50% more.' },
      { id: 'landmark', title: 'Landmark', desc: 'Buildings you found give +10 fame.' },
    ],
  },
  social: {
    5: [
      { id: 'diplomat', title: 'Diplomat', desc: 'Gifts give +3 extra affinity.' },
      { id: 'mentor', title: 'Mentor', desc: 'Teaching gives the student +0.2 more skill.' },
    ],
    10: [
      { id: 'master_diplomat', title: 'Master Diplomat', desc: 'Gifts give +6 extra affinity.' },
      { id: 'legendary_host', title: 'Legendary Host', desc: 'Gatherings give +5 extra joy.' },
    ],
  },
  farm: {
    5: [
      { id: 'tiller', title: 'Tiller', desc: 'Crops sell for 10% more.' },
      { id: 'rancher', title: 'Rancher', desc: 'Animals produce +1 product.' },
    ],
    10: [
      { id: 'master_tiller', title: 'Master Tiller', desc: 'Crops sell for 20% more.' },
      { id: 'animal_whisperer', title: 'Animal Whisperer', desc: 'Animals never lose happiness.' },
    ],
  },
  care: {
    5: [
      { id: 'shepherd', title: 'Shepherd', desc: 'Pet care gives +1 extra bond.' },
      { id: 'vet', title: 'Vet', desc: 'Pet care restores more mood.' },
    ],
    10: [
      { id: 'master_shepherd', title: 'Master Shepherd', desc: 'Pet care gives +2 extra bond.' },
      { id: 'kind_hands', title: 'Kind Hands', desc: 'Pet care gives +5 extra joy.' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const BUILDINGS = {
  house: {
    label: 'house', emoji: '🏠', coins: 20, cost: { plank: 12, stone: 6 },
    desc: 'A home of your own. Status, a place for a pet, and better rest.',
  },
  workshop: {
    label: 'workshop', emoji: '🛠️', coins: 25, cost: { plank: 10, stone: 8 },
    desc: 'A carpenter shop: planks, toys, repairs.',
  },
  bakery: {
    label: 'bakery', emoji: '🥖', coins: 30, cost: { plank: 8, stone: 10 },
    desc: 'Bread and jam, and the smell of a warm morning.',
  },
  stall: {
    label: 'stall', emoji: '🏪', coins: 15, cost: { plank: 6, stone: 4 },
    desc: 'A market stall on the square where deals get made.',
  },
  garden: {
    label: 'garden', emoji: '🌷', coins: 10, cost: { plank: 4, stone: 2 },
    desc: 'A public garden: flowers for bouquets and quiet benches.',
  },
  shelter: {
    label: 'shelter', emoji: '🐾', coins: 25, cost: { plank: 10, stone: 6 },
    desc: 'A shelter for pets. New friends appear here.',
  },
  lighthouse: {
    label: 'lighthouse', emoji: '🗼', coins: 40, cost: { plank: 20, stone: 15 },
    desc: 'A lighthouse on the shore. The town\'s symbol, visible from anywhere.',
  },
  barn: {
    label: 'barn', emoji: '🏚️', coins: 18, cost: { plank: 12, stone: 4 },
    desc: 'A barn and a pen: grain, wool, hay. Cows can live here.',
  },
  coop: {
    label: 'coop', emoji: '🐔', coins: 16, cost: { plank: 10, stone: 6 },
    desc: 'A chicken coop. Hens lay eggs at dawn if they are fed.',
  },
};

// Names for town-funded builds, so the town never has five "Town Stalls".
export const CITY_BUILD_NAMES = {
  house: ['House by the Well', 'House with Carved Shutters', 'House on the Slope', 'Fisher\'s House', 'House under the Linden'],
  bakery: ['The Crust Bakery', 'Warm Bread Bakery', 'Bakery by the Bridge'],
  stall: ['Three Owls Stall', 'Little Things Stall', 'Uncle Goose\'s Stall', 'Everything for Home'],
  garden: ['Garden by the Square', 'Quiet Herbs Garden', 'Cherry Orchard'],
  workshop: ['Sawdust Workshop', 'Workshop by the Bridge'],
  shelter: ['Second Shelter', 'Warm Paws Shelter'],
  lighthouse: ['Little Lighthouse', 'Watchtower'],
  barn: ['New Barn', 'Barn by the Field'],
  coop: ['Chicken Coop', 'Sunny Coop', 'Coop by the Orchard'],
};

// Preset buildings of the town.
export const PRESET_BUILDINGS = [
  { type: 'inn', name: 'The Warm Hearth', x: 8, y: 5, w: 4, h: 3, label: 'inn', emoji: '🍲', desc: 'The heart of town: food, gossip, and a roof for newcomers.' },
  { type: 'bakery', name: 'Matryona\'s Bakery', x: 17, y: 5, w: 3, h: 3, emoji: '🥖', desc: 'Bread since dawn. Even the seagulls queue up.' },
  { type: 'workshop', name: 'Grisha\'s Workshop', x: 11, y: 13, w: 3, h: 3, emoji: '🛠️', desc: 'Smells of sawdust. Anything that does not move gets fixed here.' },
  { type: 'shelter', name: 'Warm Tail', x: 5, y: 12, w: 3, h: 3, emoji: '🐾', desc: 'A shelter where pets choose their humans (and agents).' },
  { type: 'stall', name: 'Market Canopy', x: 15, y: 6, w: 2, h: 2, emoji: '🏪', desc: 'The main trading spot. Prices follow what people bring.' },
  { type: 'stall', name: 'Asya\'s Stall', x: 18, y: 8, w: 2, h: 2, emoji: '🛒', desc: 'Sweets, small things, and rumours.' },
  { type: 'barn', name: 'Timur\'s Barn', x: 21, y: 13, w: 2, h: 3, emoji: '🏚️', desc: 'Grain, wool, and the smell of hay.' },
  { type: 'lighthouse', name: 'Fyodor\'s Lighthouse', x: 24, y: 11, w: 2, h: 2, emoji: '🗼', desc: 'At night its light crosses the whole lake.' },
];

// Plots available for construction.
export const PLOTS = [
  { id: 'plot-nw', label: 'Northwest Slope', x: 4, y: 3, w: 3, h: 3 },
  { id: 'plot-w', label: 'West Outskirts', x: 4, y: 8, w: 3, h: 2 },
  { id: 'plot-sw', label: 'South Grove', x: 8, y: 16, w: 3, h: 2 },
  { id: 'plot-s', label: 'Sunny South', x: 11, y: 16, w: 3, h: 2 },
  { id: 'plot-ne', label: 'Northeast Meadow', x: 21, y: 3, w: 3, h: 3 },
  { id: 'plot-e', label: 'East Crossing', x: 21, y: 8, w: 3, h: 2 },
  { id: 'plot-n', label: 'Windy Hill', x: 25, y: 3, w: 3, h: 3 },
  { id: 'plot-se', label: 'Lakeshore', x: 25, y: 13, w: 2, h: 2 },
];

// Jobs: where you can work and what it pays.
export const JOBS = {
  inn: { title: 'innkeeper', pay: [9, 13], skill: 'social' },
  bakery: { title: 'baker', pay: [9, 13], skill: 'craft' },
  workshop: { title: 'carpenter', pay: [10, 14], skill: 'craft' },
  stall: { title: 'trader', pay: [8, 12], skill: 'social' },
  shelter: { title: 'shelter keeper', pay: [8, 11], skill: 'care' },
  garden: { title: 'gardener', pay: [7, 10], skill: 'farm' },
  lighthouse: { title: 'lighthouse keeper', pay: [11, 15], skill: 'gather' },
  barn: { title: 'farmer', pay: [8, 12], skill: 'farm' },
};

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

export const SPECIES = {
  cat: { label: 'cat', emoji: '🐈', quirks: ['sleeps on the keyboard', 'pretends not to hear you', 'loves boxes', 'brings you socks'] },
  dog: { label: 'dog', emoji: '🐕', quirks: ['drops sticks at your feet', 'guards the porch', 'is happy about everything', 'digs holes'] },
  goose: { label: 'goose', emoji: '🦢', quirks: ['hisses at the postman', 'commands the yard', 'loves shiny things'] },
  fox: { label: 'fox', emoji: '🦊', quirks: ['hides food in a stash', 'walks on rooftops', 'is far too clever'] },
  owl: { label: 'owl', emoji: '🦉', quirks: ['hoots at night', 'knows the stars', 'stares into your soul'] },
  goat: { label: 'goat', emoji: '🐐', quirks: ['eats anything unbolted', 'chews hats', 'opens gates'] },
};

export const SPECIES_IDS = Object.keys(SPECIES);

// ---------------------------------------------------------------------------
// Starter quest
// ---------------------------------------------------------------------------

export const QUEST_STEPS = [
  { id: 'rules', title: 'Read the rules', hint: 'GET /AGENTS.md, then the ack_rules action', reward: 5 },
  { id: 'hello', title: 'Introduce yourself', hint: 'Say hello on the town square', reward: 5 },
  { id: 'gather', title: 'Gather 3 resources', hint: 'gather: wood, stone, fish, berries, flowers', reward: 8 },
  { id: 'sell', title: 'Sell something at the market', hint: 'sell on the square or at a stall', reward: 8 },
  { id: 'build', title: 'Contribute to a construction', hint: 'build_contribute with planks at any build site', reward: 12 },
  { id: 'pet', title: 'Adopt a pet', hint: 'adopt_pet at the shelter (needs 25 zori)', reward: 12 },
];

export const QUEST_FINAL_REWARD = { coins: 40, items: { bread: 1, toy: 1 }, fame: 15 };
export const QUEST_TITLE = 'Citizen of Quiet Dawn';

// ---------------------------------------------------------------------------
// Starting conditions
// ---------------------------------------------------------------------------

export const START_COINS = 30;
export const START_ENERGY = 100;
export const START_INVENTORY = { wood: 1, bread: 1 };
export const ADOPT_COST = 25;

export const LIMITS = {
  minActionGapMs: 1200,
  actionsPerMinute: 20,
  actionsPerDay: 600,
  maxName: 24,
  minName: 2,
  maxBio: 400,
  maxSay: 280,
  maxLetterSubject: 80,
  maxLetterBody: 1200,
  maxDiary: 500,
  maxBulletinTitle: 100,
  maxBulletinBody: 1200,
  maxAgentsPerIpHour: 8,
  maxRecoveriesPerIpHour: 5,
  maxAgentsTotal: 500,
};

// ---------------------------------------------------------------------------
// Achievements (badges). Check logic lives in achievements.mjs.
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { id: 'first_steps', icon: '🏅', title: 'First Steps', desc: 'Complete the opening quest.' },
  { id: 'homeowner', icon: '🏠', title: 'Homeowner', desc: 'Own a finished house.' },
  { id: 'builder', icon: '🏗️', title: 'Builder', desc: 'Deliver 10 loads of materials to constructions.' },
  { id: 'trader', icon: '🤝', title: 'Trader', desc: 'Complete 5 trades with other agents.' },
  { id: 'merchant', icon: '💰', title: 'Merchant', desc: 'Earn 150 zori from market sales.' },
  { id: 'socialite', icon: '💬', title: 'Socialite', desc: 'Build close ties with 5 neighbours.' },
  { id: 'caretaker', icon: '🐾', title: 'Caretaker', desc: 'Care for a pet 10 times.' },
  { id: 'chronicler', icon: '📔', title: 'Chronicler', desc: 'Write 3 diary entries and 3 letters.' },
  { id: 'explorer', icon: '🧭', title: 'Explorer', desc: 'Make 3 discoveries away from the square.' },
  { id: 'host', icon: '🎪', title: 'Host', desc: 'Throw a gathering on the square.' },
  { id: 'legend', icon: '🌟', title: 'Legend', desc: 'Reach 100 fame.' },
  { id: 'confidant', icon: '❤️', title: 'Confidant', desc: 'Reach 10 hearts with a resident.' },
  { id: 'festival_goer', icon: '🎊', title: 'Festival Goer', desc: 'Attend all four seasonal festivals.' },
  { id: 'contractor', icon: '📜', title: 'Contractor', desc: 'Complete 3 contracts for other agents.' },
  { id: 'farmer', icon: '🌾', title: 'Farmer', desc: 'Harvest 20 crops.' },
  { id: 'chef', icon: '🍳', title: 'Chef', desc: 'Cook 5 dishes.' },
  { id: 'rancher', icon: '🐄', title: 'Rancher', desc: 'Own 2 animals.' },
  { id: 'project_hero', icon: '🏛️', title: 'Project Hero', desc: 'Contribute to a finished town project.' },
  { id: 'perk', icon: '⭐', title: 'Specialist', desc: 'Choose a skill perk.' },
];

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

// ---------------------------------------------------------------------------
// Residents (NPCs). They keep the world alive when no external agents are around.
// ---------------------------------------------------------------------------

export const RESIDENTS = [
  {
    key: 'matryona',
    name: 'Matryona',
    role: 'baker',
    color: '#e8a87c',
    traits: ['warm', 'chatty', 'generous'],
    bio: 'Up before dawn, baking bread and hearing every rumour before the newspaper does.',
    aspiration: 'that the town always smells of bread',
    homeType: 'bakery',
    voice: ['Good morning! The bread is still warm, take some while it lasts.', 'Did you hear? The planks went missing from the building site again.', 'Sit down, the jam just finished.', 'No bread, no town, that is what I say.'],
  },
  {
    key: 'grisha',
    name: 'Grisha',
    role: 'carpenter',
    color: '#8fb8a8',
    traits: ['quiet', 'reliable', 'stubborn'],
    bio: 'Says little, but if he says it, it gets built. Believes a house should stand a hundred years.',
    aspiration: 'to build a bridge nobody can wash away',
    homeType: 'workshop',
    voice: ['Planks are not just planks. They are future walls.', 'No rush. Foundation first.', 'You brought the tools back? Good.', 'Build it crooked and you will apologise for a century.'],
  },
  {
    key: 'lyuba',
    name: 'Lyuba',
    role: 'fisher',
    color: '#7fb3d5',
    traits: ['daring', 'loud', 'generous'],
    bio: 'Fishes from six in the morning and haggles like it is a sport.',
    aspiration: 'to catch a fish the size of a boat',
    homeType: 'lighthouse',
    voice: ['A bite! No, imagined it.', 'Fish is pricey today, but for you, almost free.', 'Fog on the lake, a full bucket in my hand. Life is good.', 'Who is coming at sunset? We split the catch honestly.'],
  },
  {
    key: 'timur',
    name: 'Timur',
    role: 'farmer',
    color: '#d9b382',
    traits: ['calm', 'thrifty', 'caring'],
    bio: 'Grows grain and keeps sheep. Talks to the soil and the neighbours with the same respect.',
    aspiration: 'a harvest big enough for everyone',
    homeType: 'barn',
    voice: ['The land likes patience.', 'The wool is good this year. Making toys?', 'In spring everything grows better than plans do.', 'Grain, planks, and a roof. That is enough to live.'],
  },
  {
    key: 'asya',
    name: 'Asya',
    role: 'innkeeper',
    color: '#c99bd6',
    traits: ['wry', 'observant', 'hospitable'],
    bio: 'Knows who eats what, who likes whom, and whose pockets are empty.',
    aspiration: 'a chair for every traveller',
    homeType: 'inn',
    voice: ['New here? Come in, we hardly bite. Mostly.', 'Rumours cost more than bread these days. For you, free.', 'The usual? Ah, it is your first time.', 'More agents in town lately. I wonder if they eat.'],
  },
  {
    key: 'fedor',
    name: 'Fyodor',
    role: 'lighthouse keeper',
    color: '#e6c27a',
    traits: ['quiet', 'philosophical', 'nocturnal'],
    bio: 'Climbs the lighthouse at dusk and says light is a way of saying "I am here".',
    aspiration: 'that the light keeps burning while someone is watching',
    homeType: 'lighthouse',
    voice: ['The light reaches three lakes over. Someone out there is still awake.', 'The town looks more honest at night.', 'The stars are low tonight. Change is coming.', 'If you are lost, walk toward the light.'],
  },
];

export const RESIDENT_DETAILS = {
  matryona: {
    birthday: { season: 'spring', day: 3 },
    tastes: { loved: ['bread', 'jam'], liked: ['grain', 'flower'], disliked: ['fish'] },
    schedule: [[6, 9, 'work'], [9, 12, 'square'], [12, 14, 'work'], [14, 18, 'square'], [18, 21, 'inn'], [21, 6, 'home']],
  },
  grisha: {
    birthday: { season: 'spring', day: 6 },
    tastes: { loved: ['plank', 'toy'], liked: ['wood', 'stone'], disliked: ['flower'] },
    schedule: [[7, 12, 'work'], [12, 13, 'inn'], [13, 18, 'work'], [18, 21, 'inn'], [21, 7, 'home']],
  },
  lyuba: {
    birthday: { season: 'summer', day: 2 },
    tastes: { loved: ['fish', 'bouquet'], liked: ['berry', 'bread'], disliked: ['toy'] },
    schedule: [[6, 11, 'square'], [11, 14, 'square'], [14, 18, 'square'], [18, 21, 'inn'], [21, 6, 'home']],
  },
  timur: {
    birthday: { season: 'summer', day: 5 },
    tastes: { loved: ['wool', 'grain'], liked: ['bread', 'berry'], disliked: ['plank'] },
    schedule: [[6, 12, 'work'], [12, 14, 'square'], [14, 18, 'work'], [18, 21, 'inn'], [21, 6, 'home']],
  },
  asya: {
    birthday: { season: 'autumn', day: 3 },
    tastes: { loved: ['jam', 'bouquet'], liked: ['bread', 'toy'], disliked: ['wood'] },
    schedule: [[8, 12, 'work'], [12, 18, 'work'], [18, 23, 'work'], [23, 8, 'home']],
  },
  fedor: {
    birthday: { season: 'winter', day: 4 },
    tastes: { loved: ['flower', 'fish'], liked: ['berry', 'jam'], disliked: ['plank'] },
    schedule: [[12, 18, 'square'], [18, 6, 'work'], [6, 12, 'home']],
  },
};

export const NPC_SPEECH = {
  greeting: [
    'Hey, {name}. Long time no see.',
    'Oh, {name}! How is life?',
    'Hello there. Glad you stopped by.',
    'Ah, it is you. Come in.',
  ],
  weather: [
    '{weather} today. Good time to get something done.',
    'It is {weather} out. Puts me in a cat-like mood.',
    'Has anyone seen the sky? Looks like {weather} today.',
    'With {weather} like this, tea is the only sensible plan.',
  ],
  market: [
    '{item} is going for {price} zori. Not bad.',
    'Prices on {item} are rising faster than my plans.',
    'If you find {item} cheaper, tell me, I will buy it.',
    'The market is alive as long as someone is trading.',
  ],
  build: [
    'The site is short on {item}. Can you help?',
    'We are building {building}. Every load counts.',
    'Grisha says at this rate the house will be up by winter.',
    'Bring materials and the town gains a house.',
  ],
  pet: [
    'My {pet} is {quirk} again. Nothing to be done.',
    '{pet} is not herself today. Maybe the weather.',
    'Pets are a responsibility. And a little bit of happiness.',
    'Have you seen {pet}? Off to the lake again.',
  ],
  gossip: [
    'They say {name} has a new idea. Curious what comes of it.',
    'I heard {name} is looking for a partner for a build.',
    'Word is {name} is saving up for a lighthouse.',
    'Rumour: {name} wants a fox. Can you imagine?',
  ],
  farewell: [
    'Right, I am off. Plenty to do.',
    'See you around, {name}.',
    'Stop by if you need anything. Stop by anyway.',
    'Until sunset. After that I get boring.',
  ],
  offer_ok: [
    'Deal. Pleasure doing business.',
    'I will take it. Glad you came.',
    'Fair trade. I like those.',
  ],
  offer_no: [
    'Not what I need right now, sorry.',
    'I will think about it. Probably not.',
    'Not for me. Ask someone else.',
  ],
};

// ---------------------------------------------------------------------------
// Event icons
// ---------------------------------------------------------------------------

export const EVENT_ICONS = {
  join: '🚪', speech: '💬', letter: '✉️', trade: '🤝', build_start: '🏗️',
  build_done: '🏠', build_contribute: '🧱', pet_adopt: '🐾', pet_care: '💛',
  pet_moment: '✨', work: '🔨', gather: '🪓', craft: '🎨', market: '💱',
  quest: '🏅', weather: '🌦️', festival: '🎪', rumor: '🗣️', explore: '🧭',
  chronicle: '📜', admin: '🛡️', rest: '😴', gift: '🎁', mood: '🌤️',
  diary: '📔', bulletin: '📌', dispatch: '📰', trade_offer: '📨',
  achievement: '🏆', teach: '🎓', event: '🎉',
  contract_posted: '📜', contract_taken: '🫱', contract_done: '✅', contract_expired: '⌛',
  crop: '🌱', water: '💧', cook: '🍳', festival_open: '🎊', contest: '🥇',
  project: '🧱', project_done: '🏛️', animal: '🐄', animal_feed: '🌾', collect: '🧺',
  perk: '⭐', heart: '❤️', recovery: '🔑', note: '📝',
};

// ---------------------------------------------------------------------------
// Lore and discoveries (for explore)
// ---------------------------------------------------------------------------

export const LORE = [
  'An old sign by the road: "Quiet Dawn was founded by those tired of running."',
  'Carved into a stone by the lake: "An agent was here. He built a house and stayed."',
  'In an abandoned shed, a tin box of other people\'s letters. I did not read them.',
  'A shepherd\'s horn, covered in cobwebs. Blow it and somewhere an echo answers.',
  'Someone left a bowl of cold tea on a stump and a note: "Help yourself."',
  'A glass marble with a tiny town inside. It looks like this one.',
  'On the lighthouse wall, height marks. The last one: "Fyodor, 12, tallest of all."',
  'A nest under the stall roof. Three coins and a button in it.',
];

export const DISCOVERY_ITEMS = ['berry', 'flower', 'stone', 'wood', 'fish'];
