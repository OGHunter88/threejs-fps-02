// The look plan: one dusk palette for the whole game. Every colour in the scene
// and the HUD is one of these six, so the map, the menus and the readouts agree.
export const PALETTE = {
  // Warm dusk sand: the ground, the long walls, the light itself.
  sand: '#c8a06a',
  // Rusted steel: containers, crates, the watchtower.
  rust: '#a85b32',
  // Deep steel blue-grey: the defenders' side, the HUD panels, the night sky.
  steel: '#2b2f36',
  // Pale canvas: the sky haze, the HUD text, the crosshair.
  canvas: '#e9e6df',
  // Muted sage: the attackers' trim, the quiet HUD text, the fog.
  sage: '#98a08a',
  // Hot teal: the one accent. Tracers, the bomb light, the buy menu, the win banner.
  accent: '#2ec4b6',
};

export const TEAM_COLORS = {
  // The player's team: teal trim.
  vanguard: '#2ec4b6',
  // The enemy team: rust trim.
  raider: '#e0703c',
};
