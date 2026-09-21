export const careerAreaOptions = [
  { value: 'technology-data', label: 'Technology & Data' },
  { value: 'business-office', label: 'Business & Office' },
  { value: 'sales-marketing-customer-service', label: 'Sales, Marketing & Customer Service' },
  { value: 'communications-creative-media', label: 'Communications & Creative Media' },
  { value: 'education-health-community', label: 'Education, Health & Community' },
  { value: 'engineering-trades-operations', label: 'Engineering, Trades & Operations' },
  { value: 'government-legal-security', label: 'Government, Legal & Security' },
] as const;

export const careerAreaLabels: Record<string, string> = Object.fromEntries(
  careerAreaOptions.map((option) => [option.value, option.label]),
);

const careerAreaAliases: Record<string, string> = {
  tech: 'technology-data',
  finance: 'business-office',
  bpo: 'sales-marketing-customer-service',
  healthcare: 'education-health-community',
  'tech-business-finance': 'technology-data',
  'sales-marketing-service-creative': 'sales-marketing-customer-service',
  'education-healthcare-hospitality-community': 'education-health-community',
  'engineering-manufacturing-agriculture-logistics': 'engineering-trades-operations',
  'public-service-legal-protective-other': 'government-legal-security',
  'technology, data, business & finance': 'technology-data',
  'sales, marketing, customer service & creative media': 'sales-marketing-customer-service',
  'education, healthcare, hospitality & community services': 'education-health-community',
  'engineering, manufacturing, agriculture, logistics & field operations': 'engineering-trades-operations',
  'public service, legal, protective services & other': 'government-legal-security',
};

export function normalizeCareerAreaValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  return careerAreaLabels[normalized] ? normalized : careerAreaAliases[normalized] || value;
}

export function getCareerAreaLabel(value: string): string {
  const normalized = normalizeCareerAreaValue(value);
  return careerAreaLabels[normalized] || value;
}
