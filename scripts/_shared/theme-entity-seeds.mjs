export const THEME_ENTITY_SEEDS = Object.freeze({
  'ai-ml': [
    { symbol: 'NVDA', company: 'NVIDIA', relationType: 'beneficiary' },
    { symbol: 'MSFT', company: 'Microsoft', relationType: 'adopter' },
    { symbol: 'GOOGL', company: 'Alphabet', relationType: 'adopter' },
    { symbol: 'AMD', company: 'AMD', relationType: 'supplier' },
  ],
  'quantum-computing': [
    { symbol: 'IBM', company: 'IBM', relationType: 'adopter' },
    { symbol: 'IONQ', company: 'IonQ', relationType: 'beneficiary' },
    { symbol: 'RGTI', company: 'Rigetti Computing', relationType: 'beneficiary' },
    { symbol: 'QBTS', company: 'D-Wave Quantum', relationType: 'beneficiary' },
  ],
  'robotics-automation': [
    { symbol: 'ISRG', company: 'Intuitive Surgical', relationType: 'beneficiary' },
    { symbol: 'ROK', company: 'Rockwell Automation', relationType: 'beneficiary' },
    { symbol: 'ABB', company: 'ABB', relationType: 'supplier' },
    { symbol: 'TSLA', company: 'Tesla', relationType: 'adopter' },
  ],
  space: [
    { symbol: 'RKLB', company: 'Rocket Lab', relationType: 'beneficiary' },
    { symbol: 'IRDM', company: 'Iridium', relationType: 'beneficiary' },
    { symbol: 'BA', company: 'Boeing', relationType: 'supplier' },
    { symbol: 'LMT', company: 'Lockheed Martin', relationType: 'supplier' },
  ],
  semiconductor: [
    { symbol: 'TSM', company: 'TSMC', relationType: 'supplier' },
    { symbol: 'ASML', company: 'ASML', relationType: 'supplier' },
    { symbol: 'NVDA', company: 'NVIDIA', relationType: 'beneficiary' },
    { symbol: 'AMD', company: 'AMD', relationType: 'beneficiary' },
  ],
  'clean-energy': [
    { symbol: 'FSLR', company: 'First Solar', relationType: 'beneficiary' },
    { symbol: 'NEE', company: 'NextEra Energy', relationType: 'beneficiary' },
    { symbol: 'ENPH', company: 'Enphase Energy', relationType: 'supplier' },
    { symbol: 'BE', company: 'Bloom Energy', relationType: 'beneficiary' },
  ],
  'climate-change': [
    { symbol: 'NEE', company: 'NextEra Energy', relationType: 'proxy' },
    { symbol: 'LIN', company: 'Linde', relationType: 'beneficiary' },
    { symbol: 'WM', company: 'Waste Management', relationType: 'proxy' },
  ],
  biotech: [
    { symbol: 'MRNA', company: 'Moderna', relationType: 'beneficiary' },
    { symbol: 'VRTX', company: 'Vertex Pharmaceuticals', relationType: 'beneficiary' },
    { symbol: 'REGN', company: 'Regeneron', relationType: 'beneficiary' },
    { symbol: 'CRSP', company: 'CRISPR Therapeutics', relationType: 'beneficiary' },
  ],
  'materials-science': [
    { symbol: 'QS', company: 'QuantumScape', relationType: 'beneficiary' },
    { symbol: 'ALB', company: 'Albemarle', relationType: 'supplier' },
    { symbol: 'MP', company: 'MP Materials', relationType: 'supplier' },
  ],
  'defense-industrial': [
    { symbol: 'LMT', company: 'Lockheed Martin', relationType: 'beneficiary' },
    { symbol: 'RTX', company: 'RTX', relationType: 'beneficiary' },
    { symbol: 'NOC', company: 'Northrop Grumman', relationType: 'beneficiary' },
    { symbol: 'GD', company: 'General Dynamics', relationType: 'beneficiary' },
  ],
});

export function listThemeEntitySeeds(theme) {
  return Array.isArray(THEME_ENTITY_SEEDS[String(theme || '').trim().toLowerCase()])
    ? THEME_ENTITY_SEEDS[String(theme || '').trim().toLowerCase()].slice()
    : [];
}
