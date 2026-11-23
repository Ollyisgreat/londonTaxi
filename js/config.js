// World layout constants. x = east, z = south, y = up. Units are metres.
export const B = 100; // distance between junction centres
export const HALF_ROAD = 7; // kerb line from road centre
export const INSET = 12; // building line from road centre
export const LANE = 3.5; // lane centre offset (we drive on the LEFT)
export const NX = 14; // junction columns
export const NZ = 12; // junction rows
export const RIVER_ROW = 6; // block row occupied by the Thames
export const RIVER_Z0 = RIVER_ROW * B + HALF_ROAD;
export const RIVER_Z1 = (RIVER_ROW + 1) * B - HALF_ROAD;
export const BRIDGES = { 3: 'Westminster Bridge', 6: 'Waterloo Bridge', 9: 'London Bridge', 12: 'Tower Bridge' };

export const ROW_NAMES = [
  'Euston Road', 'Oxford Street', 'High Holborn', 'Piccadilly', 'Strand', 'Victoria Street',
  'Victoria Embankment', 'Upper Ground', 'Stamford Street', 'Southwark Street', 'Borough Road', 'Old Kent Road',
];
export const COL_NAMES = [
  'Edgware Road', 'Park Lane', 'Bond Street', 'Regent Street', 'Charing Cross Road', 'Kingsway', "Gray's Inn Road",
  'Chancery Lane', 'Farringdon Road', 'Moorgate', 'Bishopsgate', 'Commercial Street', 'Tower Bridge Road', 'Brick Lane',
];

export function postcode(x, z) {
  const i = x / B, j = z / B;
  if (j > RIVER_ROW + 0.5) return 'SE1';
  if (i >= 10.5) return 'E1';
  if (i >= 7.5) return 'EC2';
  if (i >= 4.5) return 'WC2';
  if (i >= 2.5) return 'W1';
  return 'W2';
}
export function borough(x, z) {
  const i = x / B, j = z / B;
  if (j > RIVER_ROW + 0.5) return 'LONDON BOROUGH OF SOUTHWARK';
  if (i >= 10.5) return 'LONDON BOROUGH OF TOWER HAMLETS';
  if (i >= 7.5) return 'CITY OF LONDON';
  if (i >= 4.5) return 'LONDON BOROUGH OF CAMDEN';
  return 'CITY OF WESTMINSTER';
}

export const hasEdgeV = (i, j) => (j === RIVER_ROW ? BRIDGES[i] !== undefined : true); // (i,j)->(i,j+1)
export const nodeId = (i, j) => j * NX + i;
export const nodeIJ = (id) => [id % NX, Math.floor(id / NX)];

// Landmark blocks: cell [bi,bj] -> key
export const LANDMARK_CELLS = {
  '0,0': 'paddington',
  '6,0': 'kingscross',
  '10,1': 'liverpoolst',
  '5,1': 'museum',
  '0,2': 'park', '1,2': 'park', '0,3': 'park', '1,3': 'park',
  '2,3': 'park',
  '3,3': 'piccadilly',
  '1,4': 'harrods',
  '2,4': 'palace',
  '3,4': 'park',
  '4,4': 'trafalgar',
  '5,3': 'coventgarden',
  '8,4': 'stpauls',
  '10,3': 'gherkin',
  '2,5': 'abbey',
  '3,5': 'parliament',
  '11,5': 'tower',
  '3,7': 'countyhall',
  '4,7': 'eye',
  '5,8': 'waterloo',
  '7,7': 'tate',
  '9,7': 'shard',
  '9,8': 'londonbridge',
  '8,8': 'borough',
};

// Destinations the passengers ask for. side = which side of the block the drop-off kerb is.
export const PLACES = [
  { key: 'paddington', name: 'Paddington Station', cell: [0, 0], side: 'E', say: ['Paddington please, mate.', 'Paddington Station, I\'ve got a train to catch!'] },
  { key: 'kingscross', name: "King's Cross Station", cell: [6, 0], side: 'S', say: ["King's Cross, please.", "King's Cross St Pancras, quick as you can."] },
  { key: 'liverpoolst', name: 'Liverpool Street Station', cell: [10, 1], side: 'S', say: ['Liverpool Street station please.'] },
  { key: 'museum', name: 'The British Museum', cell: [5, 1], side: 'S', say: ['The British Museum, please!', 'Can you take us to the British Museum?'] },
  { key: 'hydepark', name: 'Hyde Park Corner', cell: [1, 3], side: 'E', say: ['Hyde Park Corner, ta.'] },
  { key: 'piccadilly', name: 'Piccadilly Circus', cell: [3, 3], side: 'N', say: ['Piccadilly Circus please, we\'re seeing a show.'] },
  { key: 'harrods', name: 'Harrods, Knightsbridge', cell: [1, 4], side: 'N', say: ['Harrods, darling.', 'Knightsbridge — Harrods, please.'] },
  { key: 'palace', name: 'Buckingham Palace', cell: [2, 4], side: 'S', say: ['Buckingham Palace please! Is the King in?', 'To the Palace!'] },
  { key: 'trafalgar', name: 'Trafalgar Square', cell: [4, 4], side: 'N', say: ['Trafalgar Square, please.', 'National Gallery, Trafalgar Square.'] },
  { key: 'coventgarden', name: 'Covent Garden', cell: [5, 3], side: 'W', say: ['Covent Garden please.', 'Covent Garden market, cheers.'] },
  { key: 'stpauls', name: "St Paul's Cathedral", cell: [8, 4], side: 'S', say: ["St Paul's Cathedral, please."] },
  { key: 'gherkin', name: '30 St Mary Axe (The Gherkin)', cell: [10, 3], side: 'W', say: ['The Gherkin. I\'m late for a meeting.', '30 St Mary Axe, please.'] },
  { key: 'abbey', name: 'Westminster Abbey', cell: [2, 5], side: 'N', say: ['Westminster Abbey please.'] },
  { key: 'parliament', name: 'Houses of Parliament', cell: [3, 5], side: 'E', say: ['Houses of Parliament. I\'ve got a vote at four.', 'Big Ben, please!'] },
  { key: 'tower', name: 'Tower of London', cell: [11, 5], side: 'N', say: ['Tower of London please.', 'Can we go to the Tower of London?'] },
  { key: 'eye', name: 'The London Eye', cell: [4, 7], side: 'S', say: ['The London Eye, please!', 'London Eye. The kids are excited!'] },
  { key: 'waterloo', name: 'Waterloo Station', cell: [5, 8], side: 'W', say: ['Waterloo, please.', 'Waterloo Station. Platform 12 if you can.'] },
  { key: 'tate', name: 'Tate Modern', cell: [7, 7], side: 'S', say: ['Tate Modern, please.'] },
  { key: 'shard', name: 'The Shard', cell: [9, 7], side: 'S', say: ['The Shard, please — I\'ve got a table at the top.'] },
  { key: 'londonbridge', name: 'London Bridge Station', cell: [9, 8], side: 'S', say: ['London Bridge station, please.'] },
  { key: 'borough', name: 'Borough Market', cell: [8, 8], side: 'W', say: ['Borough Market, please. Starving.'] },
  { key: 'countyhall', name: 'County Hall', cell: [3, 7], side: 'S', say: ['County Hall please, the aquarium.'] },
];
