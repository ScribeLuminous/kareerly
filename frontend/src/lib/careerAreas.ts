export type CareerAreaSkill = { id: string; name: string };

export type CareerAreaOption = {
  value: string;
  label: string;
  /**
   * Canonical taxonomy skills (skills_reference.csv) common in this area, most
   * recognisable first. A skill may belong to several areas. These only help a
   * candidate choose: selecting an area never adds them to the candidate's skills.
   */
  skills: CareerAreaSkill[];
};

export const careerAreaOptions: CareerAreaOption[] = [
  {
    value: 'technology-data',
    label: 'Technology & Data',
    skills: [
      { id: 'SK003', name: 'Web Development' },
      { id: 'SK005', name: 'Data Analysis' },
      { id: 'SK004', name: 'SQL' },
      { id: 'SK007', name: 'Technical Support' },
      { id: 'SK001', name: 'Python Programming' },
      { id: 'SK002', name: 'JavaScript Programming' },
      { id: 'SK677', name: 'HTML and CSS' },
      { id: 'SK678', name: 'React.js' },
      { id: 'SK657', name: 'Git Version Control' },
      { id: 'SK658', name: 'Software Testing' },
      { id: 'SK006', name: 'Data Visualization' },
      { id: 'SK669', name: 'Power BI' },
      { id: 'SK629', name: 'Microsoft Excel' },
      { id: 'SK659', name: 'Generative AI Tools' },
      { id: 'SK641', name: 'Help Desk Support' },
      { id: 'SK008', name: 'Database Management' },
      { id: 'SK009', name: 'Network Administration' },
      { id: 'SK010', name: 'Cybersecurity Awareness' },
      { id: 'SK011', name: 'Cloud Computing' },
      { id: 'SK656', name: 'WordPress' },
      { id: 'SK661', name: 'Technical Documentation' },
      { id: 'SK632', name: 'Jira' },
    ],
  },
  {
    value: 'business-office',
    label: 'Business & Office',
    skills: [
      { id: 'SK015', name: 'Office Administration' },
      { id: 'SK631', name: 'Executive Assistance' },
      { id: 'SK012', name: 'Bookkeeping' },
      { id: 'SK622', name: 'Calendar Management' },
      { id: 'SK623', name: 'Email Management' },
      { id: 'SK624', name: 'Appointment Scheduling' },
      { id: 'SK016', name: 'Document Management' },
      { id: 'SK017', name: 'Data Encoding' },
      { id: 'SK625', name: 'Data Verification' },
      { id: 'SK626', name: 'Virtual Assistance' },
      { id: 'SK627', name: 'Google Workspace' },
      { id: 'SK628', name: 'Microsoft Office' },
      { id: 'SK629', name: 'Microsoft Excel' },
      { id: 'SK630', name: 'Airtable' },
      { id: 'SK651', name: 'Invoicing and Billing' },
      { id: 'SK652', name: 'QuickBooks' },
      { id: 'SK683', name: 'Accounts Payable' },
      { id: 'SK014', name: 'Payroll Processing' },
      { id: 'SK018', name: 'Human Resource Support' },
      { id: 'SK019', name: 'Recruitment Coordination' },
      { id: 'SK021', name: 'Project Coordination' },
      { id: 'SK633', name: 'Asana' },
      { id: 'SK637', name: 'Podio' },
      { id: 'SK020', name: 'Business Communication' },
    ],
  },
  {
    value: 'sales-marketing-customer-service',
    label: 'Sales, Marketing & Customer Service',
    skills: [
      { id: 'SK029', name: 'Customer Service' },
      { id: 'SK023', name: 'Sales Techniques' },
      { id: 'SK026', name: 'Digital Marketing' },
      { id: 'SK642', name: 'HubSpot' },
      { id: 'SK276', name: 'Customer relationship management' },
      { id: 'SK030', name: 'Client Handling' },
      { id: 'SK639', name: 'Customer Success' },
      { id: 'SK640', name: 'Customer Onboarding' },
      { id: 'SK641', name: 'Help Desk Support' },
      { id: 'SK643', name: 'Salesforce' },
      { id: 'SK644', name: 'Zendesk' },
      { id: 'SK645', name: 'Help Scout' },
      { id: 'SK689', name: 'Chat Support' },
      { id: 'SK690', name: 'Email Support' },
      { id: 'SK691', name: 'Phone Support' },
      { id: 'SK314', name: 'Handle complaints' },
      { id: 'SK647', name: 'Lead Generation' },
      { id: 'SK648', name: 'Sales Operations' },
      { id: 'SK032', name: 'Negotiation' },
      { id: 'SK649', name: 'E-commerce Operations' },
      { id: 'SK650', name: 'Shopify' },
      { id: 'SK693', name: 'Order Processing' },
      { id: 'SK027', name: 'Social Media Management' },
      { id: 'SK672', name: 'Search Engine Optimization' },
      { id: 'SK675', name: 'Mailchimp' },
      { id: 'SK028', name: 'Market Research' },
    ],
  },
  {
    value: 'communications-creative-media',
    label: 'Communications & Creative Media',
    skills: [
      { id: 'SK034', name: 'Content Writing' },
      { id: 'SK040', name: 'Graphic Design' },
      { id: 'SK039', name: 'Video Editing' },
      { id: 'SK027', name: 'Social Media Management' },
      { id: 'SK035', name: 'Copywriting' },
      { id: 'SK036', name: 'Proofreading' },
      { id: 'SK020', name: 'Business Communication' },
      { id: 'SK031', name: 'English Communication' },
      { id: 'SK661', name: 'Technical Documentation' },
      { id: 'SK313', name: 'Public relations' },
      { id: 'SK038', name: 'Photography' },
      { id: 'SK041', name: 'Multimedia Design' },
      { id: 'SK042', name: 'UI Design' },
      { id: 'SK043', name: 'Audio Editing' },
      { id: 'SK044', name: 'Content Planning' },
      { id: 'SK660', name: 'Canva' },
      { id: 'SK662', name: 'Adobe Photoshop' },
      { id: 'SK663', name: 'Adobe Illustrator' },
      { id: 'SK664', name: 'Adobe Premiere Pro' },
      { id: 'SK668', name: 'Figma' },
    ],
  },
  {
    value: 'education-training',
    label: 'Education & Training',
    skills: [
      { id: 'SK045', name: 'Lesson Planning' },
      { id: 'SK048', name: 'Training Facilitation' },
      { id: 'SK049', name: 'Instructional Design' },
      { id: 'SK046', name: 'Classroom Management' },
      { id: 'SK047', name: 'Student Assessment' },
      { id: 'SK050', name: 'Learning Evaluation' },
      { id: 'SK055', name: 'Library Assistance' },
      { id: 'SK054', name: 'Records Organization' },
      { id: 'SK031', name: 'English Communication' },
    ],
  },
  {
    value: 'healthcare-wellness',
    label: 'Healthcare & Wellness',
    skills: [
      { id: 'SK655', name: 'Patient Coordination' },
      { id: 'SK058', name: 'Clinical Documentation' },
      { id: 'SK059', name: 'Caregiving' },
      { id: 'SK654', name: 'Medical Billing' },
      { id: 'SK057', name: 'Medical Terminology' },
      { id: 'SK056', name: 'Patient Assessment Support' },
      { id: 'SK061', name: 'Basic Life Support' },
      { id: 'SK064', name: 'Pharmacy Support' },
      { id: 'SK063', name: 'Laboratory Safety' },
      { id: 'SK060', name: 'Elderly Care' },
      { id: 'SK062', name: 'Medication Assistance' },
      { id: 'SK065', name: 'Fitness Coaching' },
      { id: 'SK066', name: 'Wellness Support' },
      { id: 'SK624', name: 'Appointment Scheduling' },
    ],
  },
  {
    value: 'community-social-services',
    label: 'Community & Social Services',
    skills: [
      { id: 'SK051', name: 'Community Engagement' },
      { id: 'SK053', name: 'Counselling Support' },
      { id: 'SK052', name: 'Case Documentation' },
      { id: 'SK059', name: 'Caregiving' },
      { id: 'SK060', name: 'Elderly Care' },
      { id: 'SK066', name: 'Wellness Support' },
      { id: 'SK054', name: 'Records Organization' },
      { id: 'SK111', name: 'Government Service Support' },
    ],
  },
  {
    value: 'engineering-architecture',
    label: 'Engineering & Architecture',
    skills: [
      { id: 'SK680', name: 'AutoCAD' },
      { id: 'SK067', name: 'Technical Drafting' },
      { id: 'SK069', name: 'Engineering Measurement' },
      { id: 'SK077', name: 'Surveying Support' },
      { id: 'SK068', name: 'CAD Operation' },
      { id: 'SK682', name: 'Revit' },
      { id: 'SK681', name: 'SketchUp' },
      { id: 'SK456', name: 'Quantity surveying' },
      { id: 'SK076', name: 'Quality Control' },
      { id: 'SK074', name: 'Mechanical Maintenance' },
      { id: 'SK075', name: 'Electronics Repair' },
    ],
  },
  {
    value: 'construction-maintenance',
    label: 'Construction & Maintenance',
    skills: [
      { id: 'SK070', name: 'Construction Safety' },
      { id: 'SK073', name: 'Electrical Installation' },
      { id: 'SK072', name: 'Carpentry' },
      { id: 'SK074', name: 'Mechanical Maintenance' },
      { id: 'SK071', name: 'Masonry' },
      { id: 'SK075', name: 'Electronics Repair' },
      { id: 'SK638', name: 'Procore' },
      { id: 'SK680', name: 'AutoCAD' },
      { id: 'SK456', name: 'Quantity surveying' },
      { id: 'SK091', name: 'Workplace Safety' },
      { id: 'SK497', name: 'Maintain lighting equipment' },
    ],
  },
  {
    value: 'manufacturing-logistics-transport',
    label: 'Manufacturing, Logistics & Transport',
    skills: [
      { id: 'SK098', name: 'Inventory Management' },
      { id: 'SK099', name: 'Warehouse Operations' },
      { id: 'SK089', name: 'Machine Operation' },
      { id: 'SK095', name: 'Delivery Coordination' },
      { id: 'SK094', name: 'Quality Inspection' },
      { id: 'SK090', name: 'Production Monitoring' },
      { id: 'SK092', name: 'Assembly Work' },
      { id: 'SK093', name: 'Packaging' },
      { id: 'SK076', name: 'Quality Control' },
      { id: 'SK091', name: 'Workplace Safety' },
      { id: 'SK096', name: 'Driving Safety' },
      { id: 'SK097', name: 'Route Planning' },
      { id: 'SK553', name: 'Supply chain management' },
      { id: 'SK581', name: 'Ensure stock storage safety' },
      { id: 'SK693', name: 'Order Processing' },
      { id: 'SK033', name: 'Purchasing Support' },
    ],
  },
  {
    value: 'hospitality-tourism-food-services',
    label: 'Hospitality, Tourism & Food Services',
    skills: [
      { id: 'SK078', name: 'Front Desk Support' },
      { id: 'SK080', name: 'Guest Relations' },
      { id: 'SK084', name: 'Food Service' },
      { id: 'SK083', name: 'Reservation Management' },
      { id: 'SK081', name: 'Tourism Assistance' },
      { id: 'SK082', name: 'Event Coordination' },
      { id: 'SK079', name: 'Housekeeping' },
      { id: 'SK085', name: 'Food Preparation' },
      { id: 'SK086', name: 'Food Safety' },
      { id: 'SK087', name: 'Personal Grooming Services' },
      { id: 'SK088', name: 'Laundry Services' },
      { id: 'SK029', name: 'Customer Service' },
    ],
  },
  {
    value: 'agriculture-environment',
    label: 'Agriculture & Environment',
    skills: [
      { id: 'SK100', name: 'Crop Production' },
      { id: 'SK106', name: 'Environmental Conservation' },
      { id: 'SK108', name: 'Waste Management' },
      { id: 'SK103', name: 'Animal Care' },
      { id: 'SK101', name: 'Horticulture' },
      { id: 'SK102', name: 'Pest Management' },
      { id: 'SK104', name: 'Livestock Production' },
      { id: 'SK105', name: 'Dairy Production Support' },
      { id: 'SK107', name: 'Tree Planting' },
      { id: 'SK109', name: 'Aquaculture Support' },
      { id: 'SK110', name: 'Fish Handling' },
    ],
  },
  {
    value: 'government-legal-security',
    label: 'Government, Legal & Security',
    skills: [
      { id: 'SK111', name: 'Government Service Support' },
      { id: 'SK114', name: 'Legal Documentation' },
      { id: 'SK112', name: 'Regulatory Compliance' },
      { id: 'SK117', name: 'Security Monitoring' },
      { id: 'SK113', name: 'Public Records Management' },
      { id: 'SK115', name: 'Legal Research Support' },
      { id: 'SK116', name: 'Contract Review Support' },
      { id: 'SK118', name: 'Emergency Response' },
      { id: 'SK119', name: 'Risk Reporting' },
      { id: 'SK120', name: 'Policy Support' },
      { id: 'SK121', name: 'Leadership Support' },
      { id: 'SK602', name: 'Ensure public safety and security' },
    ],
  },
];

/**
 * Broad areas offered before the list above. A saved preference keeps its
 * value; the backend matches it against every area it used to cover until the
 * candidate picks a current area.
 */
export const legacyCareerAreaOptions: Array<{ value: string; label: string; covers: string[] }> = [
  {
    value: 'education-health-community',
    label: 'Education, Health & Community',
    covers: ['education-training', 'healthcare-wellness', 'community-social-services'],
  },
  {
    value: 'engineering-trades-operations',
    label: 'Engineering, Trades & Operations',
    covers: [
      'engineering-architecture',
      'construction-maintenance',
      'manufacturing-logistics-transport',
      'hospitality-tourism-food-services',
      'agriculture-environment',
    ],
  },
];

export const careerAreaLabels: Record<string, string> = Object.fromEntries(
  [...careerAreaOptions, ...legacyCareerAreaOptions].map((option) => [option.value, option.label]),
);

const careerAreaAliases: Record<string, string> = {
  tech: 'technology-data',
  finance: 'business-office',
  bpo: 'sales-marketing-customer-service',
  healthcare: 'healthcare-wellness',
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

// The dashboard saves the label, so labels resolve back to their value.
const careerAreaLabelValues: Record<string, string> = Object.fromEntries(
  Object.entries(careerAreaLabels).map(([value, label]) => [label.toLowerCase(), value]),
);

export function normalizeCareerAreaValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (careerAreaLabels[normalized]) return normalized;
  return careerAreaLabelValues[normalized] || careerAreaAliases[normalized] || value;
}

export function getCareerAreaLabel(value: string): string {
  const normalized = normalizeCareerAreaValue(value);
  return careerAreaLabels[normalized] || value;
}

export function isLegacyCareerArea(value: string): boolean {
  const normalized = normalizeCareerAreaValue(value);
  return legacyCareerAreaOptions.some((option) => option.value === normalized);
}

/** The first few skills of an area, to help a candidate choose. */
export function careerAreaSkillExamples(value: string, count = 4): string[] {
  const option = careerAreaOptions.find((item) => item.value === normalizeCareerAreaValue(value));
  return option ? option.skills.slice(0, count).map((skill) => skill.name) : [];
}

/**
 * Names of the candidate's own confirmed skills that belong to an area. Only
 * skills the candidate already confirmed are returned; an area's other skills
 * are never attributed to the candidate.
 */
export function confirmedSkillsInCareerArea(value: string, confirmedSkillIds: Array<string | null | undefined>): string[] {
  const option = careerAreaOptions.find((item) => item.value === normalizeCareerAreaValue(value));
  if (!option) return [];
  const held = new Set(confirmedSkillIds.filter(Boolean).map((id) => String(id).trim().toUpperCase()));
  return option.skills.filter((skill) => held.has(skill.id)).map((skill) => skill.name);
}
