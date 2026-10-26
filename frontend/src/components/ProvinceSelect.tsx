import { useState } from 'react';
import { canonicalCity, provinceCities } from '../lib/phCities';
import { PH_PROVINCE_GROUPS, PH_PROVINCES } from '../lib/phProvinces';
import { FormField } from './ui';

/** The region group a listed province belongs to, or '' when it is unlisted. */
function provinceGroupLabel(province: string): string {
  return PH_PROVINCE_GROUPS.find((group) => group.provinces.includes(province))?.label || '';
}

/**
 * Region, then province: picking the region first keeps the province list
 * short. Only the province is stored; the region follows from it. A saved
 * province outside the list stays selectable.
 */
export function RegionProvinceFields({ value, onChange, required = false, regionHelp, t = (text) => text }: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  regionHelp?: string;
  /** Translates the field's own words. */
  t?: (text: string) => string;
}) {
  // The region picked before a province is chosen; once there is a province, it decides the region.
  const [pickedRegion, setPickedRegion] = useState('');
  const unlisted = Boolean(value) && !PH_PROVINCES.includes(value);
  const region = value ? provinceGroupLabel(value) : pickedRegion;
  const group = PH_PROVINCE_GROUPS.find((item) => item.label === region) || null;
  const mark = required ? ' *' : '';

  const pickRegion = (label: string) => {
    setPickedRegion(label);
    const next = PH_PROVINCE_GROUPS.find((item) => item.label === label);
    // A region with one province (Metro Manila) needs no second pick.
    if (next?.provinces.length === 1) onChange(next.provinces[0]);
    else if (!next || !next.provinces.includes(value)) onChange('');
  };

  return (
    <>
      <FormField label={`${t('Region')}${mark}`} help={regionHelp}>
        <select className="k-select" value={region} onChange={(event) => pickRegion(event.target.value)} required={required}>
          <option value="">{t('Select a region')}</option>
          {PH_PROVINCE_GROUPS.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
        </select>
      </FormField>
      <FormField label={`${t('Province')}${mark}`}>
        <select
          className="k-select"
          value={value}
          onChange={(event) => {
            // Clearing the province keeps the region it was in.
            if (!event.target.value) setPickedRegion(region);
            onChange(event.target.value);
          }}
          disabled={!group && !unlisted}
          required={required}
          autoComplete="address-level1"
        >
          <option value="">{t(group || unlisted ? 'Select a province' : 'Choose a region first')}</option>
          {unlisted && <option value={value}>{value}</option>}
          {group?.provinces.map((province) => <option key={province} value={province}>{province}</option>)}
        </select>
      </FormField>
    </>
  );
}

/**
 * The city or municipality, picked from the chosen province's list. A saved
 * city the list does not have (older free text) stays selectable.
 */
export function CityField({ province, value, onChange, required = false, help, t = (text) => text }: {
  province: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  help?: string;
  /** Translates the field's own words. */
  t?: (text: string) => string;
}) {
  const cities = provinceCities(province);
  const selected = canonicalCity(province, value) || value.trim();
  const unlisted = Boolean(selected) && !cities.includes(selected);
  const mark = required ? ' *' : '';

  return (
    <FormField label={`${t('City or municipality')}${mark}`} help={help}>
      <select
        className="k-select"
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        disabled={cities.length === 0 && !unlisted}
        required={required}
        autoComplete="address-level2"
      >
        <option value="">{t(cities.length > 0 || unlisted ? 'Select a city or municipality' : 'Choose a province first')}</option>
        {unlisted && <option value={selected}>{selected}</option>}
        {cities.map((city) => <option key={city} value={city}>{city}</option>)}
      </select>
    </FormField>
  );
}
