import { PH_PROVINCE_GROUPS, PH_PROVINCES } from '../lib/phProvinces';

/** Provinces grouped by region. A saved value outside the list stays selectable. */
export function ProvinceSelect({ id, value, onChange, required = false, 'aria-describedby': describedBy }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  'aria-describedby'?: string;
}) {
  const unlisted = value && !PH_PROVINCES.includes(value);
  return (
    <select id={id} className="k-select" value={value} onChange={(event) => onChange(event.target.value)} required={required} aria-describedby={describedBy} autoComplete="address-level1">
      <option value="">Select a province</option>
      {unlisted && <option value={value}>{value}</option>}
      {PH_PROVINCE_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.provinces.map((province) => <option key={province} value={province}>{province}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
