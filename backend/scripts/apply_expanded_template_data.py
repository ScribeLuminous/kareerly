"""Synchronize Kareerly's live CSV catalogue with the expanded K01-K24 template.

The source workbook is read-only input. This script deliberately keeps job URL
fields blank for the new public-listing snapshot rows while retaining URLs that
were already present in the reviewed catalogue.
"""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend" / "data"


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        def clean(value: str) -> str:
            return "\n".join(line.rstrip() for line in str(value or "").splitlines())

        writer.writerows({field: clean(row.get(field, "")) for field in fieldnames} for row in rows)


def split_ids(value: str) -> list[str]:
    return [item.strip().upper() for item in re.split(r"[;,|]+", value or "") if item.strip()]


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def load_template(path: Path) -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, str]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    lists = workbook["Lists"]
    list_rows = list(lists.iter_rows(values_only=True))
    category_rows = list_rows[1:]
    categories = {str(row[0]).strip(): str(row[1]).strip() for row in category_rows if row and row[0]}

    skills_sheet = workbook["Skills"]
    skill_rows = list(skills_sheet.iter_rows(values_only=True))
    headers = [str(value).strip() if value is not None else "" for value in skill_rows[0]]
    skills: dict[str, dict[str, str]] = {}
    for values in skill_rows[1:]:
        row = {headers[index]: str(value).strip() if value is not None else "" for index, value in enumerate(values)}
        if row.get("skill_id"):
            skills[row["skill_id"].upper()] = row
    skill_to_category = {skill_id: row.get("skill_category", "") for skill_id, row in skills.items()}
    workbook.close()
    return categories, skills, skill_to_category


def dominant_category(ids: list[str], skill_to_category_id: dict[str, str], default: str = "K01") -> str:
    counts = Counter(skill_to_category_id.get(skill_id, "") for skill_id in ids)
    counts.pop("", None)
    if not counts:
        return default
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def subcategories(ids: list[str], skill_rows: dict[str, dict[str, str]], category_id: str, categories: dict[str, str]) -> str:
    values = []
    for skill_id in ids:
        row = skill_rows.get(skill_id, {})
        if row.get("skill_category_id") == category_id and row.get("skill_subcategory"):
            values.append(row["skill_subcategory"])
    return "\n".join(unique(values)[:6]) or categories.get(category_id, "")


def add_job(
    skill_rows: dict[str, dict[str, str]],
    categories: dict[str, str],
    job_id: str,
    category_id: str,
    title: str,
    description: str,
    skill_ids: str,
    level: str,
    location: str,
    work_type: str,
    salary: str = "Not specified",
    company: str = "",
) -> dict[str, str]:
    ids = split_ids(skill_ids)
    names = [skill_rows[item]["skill_name"] for item in ids if item in skill_rows]
    category = categories[category_id]
    text = " ".join(filter(None, [title, company, description, " ".join(names), category]))
    return {
        "job_id": job_id,
        "category_id": category_id,
        "job_category": category,
        "job_subcategory": category,
        "job_title": title,
        "job_description": description,
        "required_skills_comma_separated": ", ".join(names),
        "required_skill_ids": ";".join(ids),
        "mapped_required_skill_names": "; ".join(names),
        "nice_to_have_skills_optional": "",
        "nice_to_have_skill_ids": "",
        "mapped_nice_to_have_skill_names": "",
        "skill_gap_reliability": "high",
        "skill_id_mapping_status": "template_category_skills",
        "skill_id_mapping_notes": "Required skill IDs are canonical IDs from the expanded K01-K24 taxonomy.",
        "experience_level_required": level,
        "location": location,
        "work_type": work_type,
        "salary_range_monthly_php": salary,
        "external_job_link_optional": "",
        "source_dataset": "JobStreet public listing snapshot (2026-09-22)",
        "job_text_for_matching": text.lower(),
    }


def add_resource(
    skill_rows: dict[str, dict[str, str]],
    categories: dict[str, str],
    resource_id: str,
    title: str,
    description: str,
    skill_ids: str,
    category_id: str,
    provider: str,
    provider_type: str,
    resource_type: str,
    credential_type: str,
    url: str,
    duration: str,
    delivery: str,
    cost: str,
) -> dict[str, str]:
    ids = split_ids(skill_ids)
    names = [skill_rows[item]["skill_name"] for item in ids if item in skill_rows]
    return {
        "resource_id": resource_id,
        "course_or_certification_title": title,
        "course_or_certification_description": description,
        "recommended_experience": "Beginner Friendly",
        "schedule": "Flexible; confirm provider schedule",
        "level": "Beginner to intermediate",
        "estimated_duration": duration,
        "skills_youll_gain": ", ".join(names),
        "skill_ids": ";".join(ids),
        "category_id": category_id,
        "category_name": categories[category_id],
        "offered_by_provider": provider,
        "provider_type": provider_type,
        "provider_trust_score_auto": "90",
        "resource_type": resource_type,
        "credential_type": credential_type,
        "language": "English",
        "delivery_mode": delivery,
        "cost_type": cost,
        "status": "Active",
        "notes": "Official provider page checked 2026-09-22; confirm current eligibility, fees, and schedule with the provider.",
        "external_course_or_certification_link": url,
        "mapped_skill_names": "; ".join(names),
        "skill_id_mapping_status": "template_category_skills",
        "skill_id_mapping_notes": "Recommended to close common gaps for jobs in this K01-K24 category.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    args = parser.parse_args()
    categories, template_skills, _ = load_template(args.template)

    category_by_name = {name: category_id for category_id, name in categories.items()}
    skill_rows = {}
    for skill_id, row in template_skills.items():
        category_name = row.get("skill_category", "")
        skill_rows[skill_id] = {**row, "skill_category_id": category_by_name.get(category_name, "")}
    skill_to_category_id = {skill_id: row["skill_category_id"] for skill_id, row in skill_rows.items()}

    skills_path = DATA / "skills_reference.csv"
    skill_headers, skills = read_csv(skills_path)
    for row in skills:
        template = skill_rows.get(row.get("skill_id", "").upper())
        if template:
            row["category_id"] = template["skill_category_id"]
            row["skill_category"] = template["skill_category"]
            if template.get("skill_subcategory"):
                row["skill_subcategory"] = template["skill_subcategory"]
    write_csv(skills_path, skill_headers, skills)

    jobs_path = DATA / "reference_jobs.csv"
    job_headers, jobs = read_csv(jobs_path)
    for row in jobs:
        ids = split_ids(row.get("required_skill_ids", ""))
        category_id = dominant_category(ids, skill_to_category_id, row.get("category_id", "K01"))
        row["category_id"] = category_id
        row["job_category"] = categories.get(category_id, row.get("job_category", ""))
        row["job_subcategory"] = subcategories(ids, skill_rows, category_id, categories)
        row["job_text_for_matching"] = " ".join(
            filter(None, [row.get("job_text_for_matching", ""), row["job_category"], row["job_subcategory"]])
        ).lower()
    new_jobs = [
        ("K01", "Software Engineer Fullstack", "Build and maintain full-stack applications, collaborate with product teams, and deliver reliable software.", "SK002;SK003;SK004", "Junior", "Bonifacio Global City, Metro Manila", "Hybrid", "Not specified", "NCS Philippines"),
        ("K02", "Data Analyst", "Prepare, analyze, and present operational data to support business decisions and reporting.", "SK005;SK006;SK004", "Junior", "Pasay, Metro Manila", "On-site", "Not specified", "One Outsource Direct Corporation"),
        ("K03", "Junior Specialist Cybersecurity Operations", "Monitor security events, assist with incident response, and support cybersecurity operations.", "SK007;SK010;SK117;SK119", "Junior", "Makati, Metro Manila", "Hybrid", "Not specified", "PUMA Sports Philippines Inc."),
        ("K04", "Accounting Assistant", "Support bookkeeping, reconciliations, and day-to-day accounting records.", "SK012;SK013;SK016", "Entry Level", "Bacoor, Cavite", "On-site", "₱20,000-₱21,000/month", "Trem Franch Co. Inc."),
        ("K05", "HR Admin Clerk", "Maintain personnel files, process office records, and provide administrative support.", "SK015;SK016;SK017", "Entry Level", "Makati, Metro Manila", "On-site", "Not specified", "Marie France Bodyline International"),
        ("K06", "Human Resources Assistant", "Support recruitment coordination, employee records, and routine HR operations.", "SK018;SK019;SK021", "Junior", "Fort Bonifacio, Metro Manila", "On-site", "₱22,000-₱25,000/month", "Ocean Wave Services"),
        ("K07", "Sales and Marketing Associate", "Develop client leads, support sales activities, and coordinate commercial proposals.", "SK023;SK025;SK028", "Junior", "Muntinlupa, Metro Manila", "On-site", "₱15,000-₱20,000/month", "SOCOTEC Certification Philippines Inc."),
        ("K08", "Digital Marketing and Travel Sales Associate", "Plan digital campaigns, create promotional content, and support travel sales enquiries.", "SK026;SK027;SK028", "Junior", "Ortigas, Metro Manila", "On-site", "₱21,000-₱22,000/month", "ONEEVA Travel Corporation"),
        ("K09", "Customer Service Representative (Voice)", "Resolve customer enquiries by phone, document interactions, and meet service quality targets.", "SK029;SK030;SK031", "Entry Level", "Metro Manila", "Remote", "Not specified", "CEF Solutions Philippines"),
        ("K10", "Marketing Communications and External Relations Coordinator", "Prepare written communications, coordinate external messaging, and support stakeholder engagement.", "SK020;SK031;SK034", "Junior", "Bonifacio Global City, Metro Manila", "Hybrid", "₱30,000-₱40,000/month", "Private Advertiser"),
        ("K11", "Graphic Designer (Packaging and Brand Assets)", "Create digital and print design assets for packaging, campaigns, and brand communications.", "SK039;SK040;SK042", "Junior", "Pasig, Metro Manila", "Remote", "Not specified", "Twoconnect Philippines"),
        ("K12", "MAPEH Teacher", "Plan lessons, deliver classroom instruction, and assess student learning in music, arts, physical education, and health.", "SK045;SK046;SK048", "Entry Level", "Antipolo, Rizal", "On-site", "₱13,200-₱14,000/month", "WILL School of Antipolo"),
        ("K13", "Community Development Organizer", "Coordinate community activities, document field work, and work with local stakeholders.", "SK051;SK052;SK053", "Junior", "Surigao City", "Field-based", "Not specified", "Philippine Red Cross"),
        ("K14", "Registered Nurse - Clinical Coordination", "Coordinate clinical cases, review medical information, and communicate care requirements with stakeholders.", "SK056;SK057;SK058;SK063", "Mid Level", "Metro Manila", "Remote", "₱47,000-₱70,000/month", "Advanced Telemed Inc."),
        ("K15", "Stay-in Caregiver", "Provide safe daily living support, observe wellbeing, and assist with personal care routines.", "SK059;SK060;SK061;SK062", "Entry Level", "Sampaloc, Metro Manila", "On-site", "Not specified", "Central Affirmative Company"),
        ("K16", "Site Civil Engineer", "Coordinate site engineering work, review plans, and monitor construction quality and progress.", "SK067;SK068;SK069", "Junior", "Metro Manila", "On-site", "Not specified", "Briobuild Co."),
        ("K17", "Cost Estimator", "Prepare quantity take-offs, cost estimates, and supporting documentation for construction projects.", "SK070;SK071;SK073", "Junior", "Mandaluyong, Metro Manila", "On-site", "₱20,000-₱25,000/month", "OMNIFICA Construction and Development Corporation"),
        ("K18", "Hotel Front Desk Associate", "Welcome guests, manage reservations, and coordinate front-office requests throughout the guest stay.", "SK078;SK080;SK081;SK083", "Entry Level", "Metro Manila", "On-site", "Not specified", "JobStreet hospitality listing snapshot"),
        ("K19", "Chef de Partie", "Prepare food to recipe and safety standards while coordinating kitchen station operations.", "SK084;SK085;SK091", "Junior", "Pasay, Metro Manila", "On-site", "₱28,000-₱35,000/month", "The Moment Group"),
        ("K20", "Warehouse Associate", "Receive, organize, pick, and dispatch inventory while maintaining accurate warehouse records.", "SK095;SK096;SK097", "Entry Level", "Santa Rosa, Laguna", "On-site", "Not specified", "DHL Supply Chain Philippines"),
        ("K21", "Quality Assurance Engineer", "Inspect manufacturing processes, analyze quality data, and support corrective actions.", "SK089;SK090;SK094", "Junior", "Calamba, Laguna", "On-site", "Not specified", "Denso Philippines"),
        ("K22", "Agricultural Field Technician", "Support field trials, collect crop data, and assist with agricultural production activities.", "SK100;SK101;SK102;SK103", "Junior", "Jaen, Nueva Ecija", "Field-based", "₱20,000-₱22,000/month", "Kenso Philippines Inc."),
        ("K23", "Administrative Officer - Government Service Support", "Maintain government records, prepare administrative reports, and support public-service transactions.", "SK111;SK112;SK113", "Junior", "Bicol Region", "On-site", "Not specified", "Central Bicol State University of Agriculture"),
        ("K24", "Security Operations Officer", "Support site security, incident reporting, safety procedures, and protective operations.", "SK114;SK115;SK117;SK118", "Junior", "Quezon City, Metro Manila", "On-site", "Not specified", "New City Builders"),
    ]
    existing_job_ids = {row.get("job_id", "") for row in jobs}
    for index, (category_id, title, description, ids, level, location, work_type, salary, company) in enumerate(new_jobs, start=1):
        job_id = f"WEB-20260922-K{index:02d}"
        if job_id not in existing_job_ids:
            jobs.append(add_job(skill_rows, categories, job_id, category_id, title, description, ids, level, location, work_type, salary, company))
    write_csv(jobs_path, job_headers, jobs)

    resources_path = DATA / "learning_resources.csv"
    resource_headers, resources = read_csv(resources_path)
    for row in resources:
        ids = split_ids(row.get("skill_ids", ""))
        category_id = dominant_category(ids, skill_to_category_id, row.get("category_id", "K01"))
        row["category_id"] = category_id
        row["category_name"] = categories.get(category_id, row.get("category_name", ""))
    resource_definitions = [
        ("Google IT Automation with Python Certificate", "Build practical Python automation skills for IT and software support work.", "SK001;SK003", "K01", "Google", "Technology provider", "Course/Certification", "professional_certificate", "https://grow.google/certificates/it-automation-python/", "6 months", "Online/Self-paced", "Free trial/Paid"),
        ("Microsoft Certified: Power BI Data Analyst Associate", "Validate data preparation, modelling, visualization, and analysis skills with Power BI.", "SK005;SK006", "K02", "Microsoft", "Technology provider", "Certification", "industry_certification", "https://learn.microsoft.com/en-us/credentials/certifications/data-analyst-associate/", "Self-paced", "Online/Self-paced", "Paid exam"),
        ("Google Cybersecurity Certificate", "Develop foundations in security operations, incident response, and cybersecurity analysis.", "SK007;SK010;SK117", "K03", "Google", "Technology provider", "Course/Certification", "professional_certificate", "https://grow.google/certificates/cybersecurity/", "6 months", "Online/Self-paced", "Free trial/Paid"),
        ("Intuit Academy Bookkeeping Professional Certificate", "Practice bookkeeping, accounting fundamentals, and financial record workflows.", "SK012;SK013", "K04", "Intuit / Coursera", "MOOC platform", "Course/Certification", "professional_certificate", "https://www.coursera.org/professional-certificates/intuit-bookkeeping", "4 months", "Online/Self-paced", "Free trial/Paid"),
        ("Microsoft Office Specialist: Excel Associate", "Demonstrate spreadsheet skills used in office administration, reporting, and records work.", "SK015;SK017;SK016", "K05", "Microsoft", "Technology provider", "Certification", "industry_certification", "https://learn.microsoft.com/en-us/credentials/certifications/mos-excel-associate-m365-apps/", "Self-paced", "Online/Self-paced", "Paid exam"),
        ("Associate Professional in Human Resources (aPHR)", "Build foundational HR knowledge for recruitment, employee support, and HR operations.", "SK018;SK019", "K06", "HRCI", "Professional body", "Certification", "industry_certification", "https://www.hrci.org/certifications", "Self-paced", "Online/Self-paced", "Paid exam"),
        ("Salesforce Associate Certification", "Learn CRM fundamentals, customer data, and sales-support workflows.", "SK023;SK025", "K07", "Salesforce", "Technology provider", "Certification", "industry_certification", "https://trailhead.salesforce.com/credentials/associateoverview", "6 weeks", "Online/Self-paced", "Provider-dependent"),
        ("Google Digital Marketing and E-commerce Certificate", "Build skills in digital campaigns, search, analytics, and e-commerce operations.", "SK026;SK027;SK028", "K08", "Google", "Technology provider", "Course/Certification", "professional_certificate", "https://grow.google/certificates/digital-marketing-ecommerce/", "6 months", "Online/Self-paced", "Free trial/Paid"),
        ("TESDA Customer Services NC II", "Develop customer-service communication, client support, and service-quality skills.", "SK029;SK030;SK031", "K09", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/Download", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Contact Center Services NC II", "Practice contact-center communication, call handling, documentation, and customer support.", "SK020;SK031;SK034", "K10", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/Download", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("Adobe Certified Professional: Graphic Design", "Validate core graphic-design and Adobe Creative Cloud production skills.", "SK040;SK041;SK042", "K11", "Adobe", "Technology provider", "Certification", "industry_certification", "https://certifiedprofessional.adobe.com/en/resources/graphic-design-certification", "Self-paced", "Online/Self-paced", "Paid exam"),
        ("TESDA Trainers Methodology Level I", "Build foundational lesson planning, instructional delivery, and assessment skills.", "SK045;SK048;SK049", "K12", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/download/", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Community Nutrition Services NC II", "Develop community-service and public-facing support skills for community programmes.", "SK051;SK052", "K13", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/download/", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("Philippine Red Cross Standard First Aid and Basic Life Support", "Practice first aid and basic life-support responses for community and care settings.", "SK056;SK061;SK063", "K14", "Philippine Red Cross", "Humanitarian organization", "Training Certificate", "certificate_course", "https://redcross.org.ph/trainings/", "Provider schedule", "Provider-based", "Provider-dependent"),
        ("TESDA Caregiving NC II", "Build practical caregiving, personal care, safety, and wellness-support skills.", "SK059;SK060;SK062", "K15", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://tesda.gov.ph/Downloadables/TRs/TR%20Caregiving%20NC%20II.pdf", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Technical Drafting NC II", "Develop technical drawing, drafting, and design-documentation skills.", "SK067;SK068;SK069", "K16", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://tesda.gov.ph/Downloadables/TR%20-%20Technical%20drafting%20NC%20II.pdf", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Shielded Metal Arc Welding NC II", "Practice welding processes, workplace safety, and skilled-trade operations.", "SK070;SK073", "K17", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/Download?Searchcat=Regul", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Front Office Services NC II", "Develop front-office, guest-service, reservation, and hospitality operations skills.", "SK078;SK080;SK083", "K18", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/Download", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Cookery NC II", "Build food preparation, kitchen safety, and cookery production skills.", "SK084;SK085", "K19", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://tesda.gov.ph/Downloadables/TRs/TR%20Cookery%20NC%20II.pdf", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Warehousing Services NC II", "Develop inventory, receiving, picking, storage, and warehouse documentation skills.", "SK095;SK097", "K20", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/download/", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Process Inspection NC II", "Practice inspection, quality checks, measurement, and process documentation.", "SK090;SK094", "K21", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://tesda.gov.ph/Downloadables/TR%20-%20Process%20Inspection%20NC%20II.pdf", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("TESDA Agricultural Crops Production NC II", "Build practical crop-production, field-record, and agricultural operations skills.", "SK100;SK101;SK102", "K22", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/Download/Training_Regulations?currentFilter=C&page=2", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
        ("Philippine Civil Service Commission Special Eligibilities", "Review eligibility pathways relevant to Philippine government and public-administration careers.", "SK111;SK112;SK113", "K23", "Civil Service Commission", "Government agency", "Eligibility", "industry_certification", "https://www.csc.gov.ph/special-eligibilities", "Varies", "Online/Provider-based", "Varies"),
        ("TESDA Security Services NC II", "Develop security operations, incident reporting, safety, and protective-service skills.", "SK114;SK117;SK118", "K24", "TESDA", "National training authority", "National Certificate", "industry_certification", "https://www.tesda.gov.ph/Download?Searchcat=Regul", "Provider schedule", "Blended/Provider-based", "Provider-dependent"),
    ]
    existing_resource_ids = {row.get("resource_id", "") for row in resources}
    for index, definition in enumerate(resource_definitions, start=1):
        resource_id = f"CERT-20260922-K{index:02d}"
        if resource_id not in existing_resource_ids:
            resources.append(add_resource(skill_rows, categories, resource_id, *definition))
    write_csv(resources_path, resource_headers, resources)

    category_headers = ["category_id", "category_name", "category_description", "source"]
    category_rows = [
        {"category_id": category_id, "category_name": name, "category_description": "", "source": "Expanded entry template"}
        for category_id, name in categories.items()
    ]
    write_csv(DATA / "category_reference.csv", category_headers, category_rows)

    print(f"Synchronized {len(skills)} skills, {len(jobs)} jobs, and {len(resources)} learning resources across {len(categories)} categories.")


if __name__ == "__main__":
    main()
