// Provinces grouped by region, in the PSA's region order. Codes match PH_REGIONS
// (regionPreference.ts) and REGIONS in backend/app/services/ph_regions.py, and a
// backend test checks that each "City, Province" saved from this list resolves
// to its region. Metro Manila stands in for NCR, which has no provinces.
export type ProvinceGroup = { region: string; label: string; provinces: string[] };

export const PH_PROVINCE_GROUPS: ProvinceGroup[] = [
  { region: 'NCR', label: 'NCR (Metro Manila)', provinces: ['Metro Manila'] },
  { region: 'CAR', label: 'CAR (Cordillera)', provinces: ['Abra', 'Apayao', 'Benguet', 'Ifugao', 'Kalinga', 'Mountain Province'] },
  { region: 'I', label: 'Region I (Ilocos)', provinces: ['Ilocos Norte', 'Ilocos Sur', 'La Union', 'Pangasinan'] },
  { region: 'II', label: 'Region II (Cagayan Valley)', provinces: ['Batanes', 'Cagayan', 'Isabela', 'Nueva Vizcaya', 'Quirino'] },
  { region: 'III', label: 'Region III (Central Luzon)', provinces: ['Aurora', 'Bataan', 'Bulacan', 'Nueva Ecija', 'Pampanga', 'Tarlac', 'Zambales'] },
  { region: 'IV-A', label: 'Region IV-A (CALABARZON)', provinces: ['Batangas', 'Cavite', 'Laguna', 'Quezon', 'Rizal'] },
  { region: 'IV-B', label: 'MIMAROPA', provinces: ['Marinduque', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Romblon'] },
  { region: 'V', label: 'Region V (Bicol)', provinces: ['Albay', 'Camarines Norte', 'Camarines Sur', 'Catanduanes', 'Masbate', 'Sorsogon'] },
  { region: 'VI', label: 'Region VI (Western Visayas)', provinces: ['Aklan', 'Antique', 'Capiz', 'Guimaras', 'Iloilo'] },
  { region: 'NIR', label: 'Negros Island Region', provinces: ['Negros Occidental', 'Negros Oriental', 'Siquijor'] },
  { region: 'VII', label: 'Region VII (Central Visayas)', provinces: ['Bohol', 'Cebu'] },
  { region: 'VIII', label: 'Region VIII (Eastern Visayas)', provinces: ['Biliran', 'Eastern Samar', 'Leyte', 'Northern Samar', 'Samar', 'Southern Leyte'] },
  { region: 'IX', label: 'Region IX (Zamboanga Peninsula)', provinces: ['Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay'] },
  { region: 'X', label: 'Region X (Northern Mindanao)', provinces: ['Bukidnon', 'Camiguin', 'Lanao del Norte', 'Misamis Occidental', 'Misamis Oriental'] },
  { region: 'XI', label: 'Region XI (Davao)', provinces: ['Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental'] },
  { region: 'XII', label: 'Region XII (SOCCSKSARGEN)', provinces: ['Cotabato', 'Sarangani', 'South Cotabato', 'Sultan Kudarat'] },
  { region: 'XIII', label: 'Region XIII (Caraga)', provinces: ['Agusan del Norte', 'Agusan del Sur', 'Dinagat Islands', 'Surigao del Norte', 'Surigao del Sur'] },
  { region: 'BARMM', label: 'BARMM', provinces: ['Basilan', 'Lanao del Sur', 'Maguindanao del Norte', 'Maguindanao del Sur', 'Tawi-Tawi'] },
  // Sulu left BARMM in 2024 and has no region on record yet, so it maps to none.
  { region: '', label: 'Other', provinces: ['Sulu'] },
];

export const PH_PROVINCES: string[] = PH_PROVINCE_GROUPS.flatMap((group) => group.provinces);

const PROVINCE_ALIASES: Record<string, string> = { ncr: 'Metro Manila', 'national capital region': 'Metro Manila', 'metro manila': 'Metro Manila' };

/** The list's spelling of a province, or '' when the text names none. */
export function canonicalProvince(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return '';
  return PH_PROVINCES.find((province) => province.toLowerCase() === key) || PROVINCE_ALIASES[key] || '';
}

/** The region code of a listed province, or '' when it has none. */
export function provinceRegion(province: string): string {
  return PH_PROVINCE_GROUPS.find((group) => group.provinces.includes(province))?.region || '';
}

/**
 * Splits a saved "City, Province" location. A last part that names a listed
 * province becomes the province; otherwise the first part is the city and the
 * rest is kept as the province text so nothing saved is lost.
 */
export function splitLocation(location: string | null | undefined): { city: string; province: string } {
  const parts = (location || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', province: '' };
  const province = canonicalProvince(parts[parts.length - 1]);
  if (province) return { city: parts.slice(0, -1).join(', '), province };
  return { city: parts[0], province: parts.slice(1).join(', ') };
}

/** The single location text stored for a city and province. */
export function joinLocation(city: string, province: string): string {
  return [city.trim(), province.trim()].filter(Boolean).join(', ');
}
