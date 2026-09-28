"""Fixed reference data for the synthetic resume generator: regions, the
approved location lookup, and synthetic name pools.

Locations are keyed on (city, province); never infer a region from a city name
alone ("San Jose" is both Occidental Mindoro and Dinagat Islands).
"""

REFERENCE_DATE = "2026-09-28"
SEED = 20260928

REGIONS = [
    ("NCR", "National Capital Region"),
    ("CAR", "Cordillera Administrative Region"),
    ("I", "Ilocos Region"),
    ("II", "Cagayan Valley"),
    ("III", "Central Luzon"),
    ("IV-A", "CALABARZON"),
    ("IV-B", "MIMAROPA"),
    ("V", "Bicol Region"),
    ("VI", "Western Visayas"),
    ("NIR", "Negros Island Region"),
    ("VII", "Central Visayas"),
    ("VIII", "Eastern Visayas"),
    ("IX", "Zamboanga Peninsula"),
    ("X", "Northern Mindanao"),
    ("XI", "Davao Region"),
    ("XII", "SOCCSKSARGEN"),
    ("XIII", "Caraga"),
    ("BARMM", "Bangsamoro Autonomous Region in Muslim Mindanao"),
]
REGION_NAMES = dict(REGIONS)

# (region_code, city/municipality, province)
LOCATIONS = [
    ("NCR", "Quezon City", "Metro Manila"), ("NCR", "Manila", "Metro Manila"),
    ("NCR", "Pasig City", "Metro Manila"), ("NCR", "Marikina City", "Metro Manila"),
    ("NCR", "Caloocan City", "Metro Manila"), ("NCR", "Parañaque City", "Metro Manila"),
    ("NCR", "Valenzuela City", "Metro Manila"),
    ("CAR", "Baguio City", "Benguet"), ("CAR", "La Trinidad", "Benguet"), ("CAR", "Tabuk City", "Kalinga"),
    ("CAR", "Bangued", "Abra"), ("CAR", "Lagawe", "Ifugao"), ("CAR", "Bontoc", "Mountain Province"),
    ("I", "San Fernando City", "La Union"), ("I", "Laoag City", "Ilocos Norte"), ("I", "Vigan City", "Ilocos Sur"),
    ("I", "Dagupan City", "Pangasinan"), ("I", "Urdaneta City", "Pangasinan"), ("I", "Alaminos City", "Pangasinan"),
    ("II", "Tuguegarao City", "Cagayan"), ("II", "Santiago City", "Isabela"), ("II", "Ilagan City", "Isabela"),
    ("II", "Cauayan City", "Isabela"), ("II", "Bayombong", "Nueva Vizcaya"), ("II", "Cabarroguis", "Quirino"),
    ("III", "Angeles City", "Pampanga"), ("III", "City of San Fernando", "Pampanga"),
    ("III", "Olongapo City", "Zambales"), ("III", "Malolos City", "Bulacan"), ("III", "Tarlac City", "Tarlac"),
    ("III", "Cabanatuan City", "Nueva Ecija"), ("III", "Balanga City", "Bataan"), ("III", "Baler", "Aurora"),
    ("IV-A", "Calamba City", "Laguna"), ("IV-A", "San Pablo City", "Laguna"), ("IV-A", "Lipa City", "Batangas"),
    ("IV-A", "Batangas City", "Batangas"), ("IV-A", "Lucena City", "Quezon"), ("IV-A", "Antipolo City", "Rizal"),
    ("IV-A", "Dasmariñas City", "Cavite"),
    ("IV-B", "Puerto Princesa City", "Palawan"), ("IV-B", "Calapan City", "Oriental Mindoro"),
    ("IV-B", "San Jose", "Occidental Mindoro"), ("IV-B", "Boac", "Marinduque"), ("IV-B", "Odiongan", "Romblon"),
    ("IV-B", "Mamburao", "Occidental Mindoro"),
    ("V", "Legazpi City", "Albay"), ("V", "Tabaco City", "Albay"), ("V", "Naga City", "Camarines Sur"),
    ("V", "Iriga City", "Camarines Sur"), ("V", "Sorsogon City", "Sorsogon"), ("V", "Masbate City", "Masbate"),
    ("V", "Daet", "Camarines Norte"), ("V", "Virac", "Catanduanes"),
    ("VI", "Iloilo City", "Iloilo"), ("VI", "Passi City", "Iloilo"), ("VI", "Roxas City", "Capiz"),
    ("VI", "Kalibo", "Aklan"), ("VI", "San Jose de Buenavista", "Antique"), ("VI", "Jordan", "Guimaras"),
    ("NIR", "Bacolod City", "Negros Occidental"), ("NIR", "Silay City", "Negros Occidental"),
    ("NIR", "Kabankalan City", "Negros Occidental"), ("NIR", "Dumaguete City", "Negros Oriental"),
    ("NIR", "Bais City", "Negros Oriental"), ("NIR", "Bayawan City", "Negros Oriental"),
    ("NIR", "Siquijor", "Siquijor"),
    ("VII", "Cebu City", "Cebu"), ("VII", "Mandaue City", "Cebu"), ("VII", "Lapu-Lapu City", "Cebu"),
    ("VII", "Toledo City", "Cebu"), ("VII", "Danao City", "Cebu"), ("VII", "Tagbilaran City", "Bohol"),
    ("VII", "Tubigon", "Bohol"),
    ("VIII", "Tacloban City", "Leyte"), ("VIII", "Ormoc City", "Leyte"), ("VIII", "Catbalogan City", "Samar"),
    ("VIII", "Calbayog City", "Samar"), ("VIII", "Borongan City", "Eastern Samar"),
    ("VIII", "Maasin City", "Southern Leyte"), ("VIII", "Catarman", "Northern Samar"), ("VIII", "Naval", "Biliran"),
    ("IX", "Zamboanga City", "Zamboanga del Sur"), ("IX", "Pagadian City", "Zamboanga del Sur"),
    ("IX", "Dipolog City", "Zamboanga del Norte"), ("IX", "Dapitan City", "Zamboanga del Norte"),
    ("IX", "Ipil", "Zamboanga Sibugay"), ("IX", "Molave", "Zamboanga del Sur"),
    ("IX", "Sindangan", "Zamboanga del Norte"),
    ("X", "Cagayan de Oro City", "Misamis Oriental"), ("X", "Gingoog City", "Misamis Oriental"),
    ("X", "Iligan City", "Lanao del Norte"), ("X", "Malaybalay City", "Bukidnon"), ("X", "Valencia City", "Bukidnon"),
    ("X", "Ozamiz City", "Misamis Occidental"), ("X", "Oroquieta City", "Misamis Occidental"),
    ("X", "Mambajao", "Camiguin"),
    ("XI", "Davao City", "Davao del Sur"), ("XI", "Digos City", "Davao del Sur"), ("XI", "Tagum City", "Davao del Norte"),
    ("XI", "Panabo City", "Davao del Norte"), ("XI", "Mati City", "Davao Oriental"), ("XI", "Nabunturan", "Davao de Oro"),
    ("XII", "General Santos City", "South Cotabato"), ("XII", "Koronadal City", "South Cotabato"),
    ("XII", "Kidapawan City", "Cotabato"), ("XII", "Tacurong City", "Sultan Kudarat"),
    ("XII", "Isulan", "Sultan Kudarat"), ("XII", "Alabel", "Sarangani"),
    ("XIII", "Butuan City", "Agusan del Norte"), ("XIII", "Cabadbaran City", "Agusan del Norte"),
    ("XIII", "Bayugan City", "Agusan del Sur"), ("XIII", "Surigao City", "Surigao del Norte"),
    ("XIII", "Tandag City", "Surigao del Sur"), ("XIII", "Bislig City", "Surigao del Sur"),
    ("XIII", "San Jose", "Dinagat Islands"),
    ("BARMM", "Cotabato City", "Maguindanao del Norte"), ("BARMM", "Parang", "Maguindanao del Norte"),
    ("BARMM", "Datu Odin Sinsuat", "Maguindanao del Norte"), ("BARMM", "Buluan", "Maguindanao del Sur"),
    ("BARMM", "Marawi City", "Lanao del Sur"), ("BARMM", "Malabang", "Lanao del Sur"),
    ("BARMM", "Lamitan City", "Basilan"), ("BARMM", "Bongao", "Tawi-Tawi"),
]

FORBIDDEN_PLACES = ("sulu", "jolo", "isabela city")

# Synthetic name pools. Names are recombined at random and denote no real
# person. Surnames of prominent public figures and political families are left
# out on purpose (see BLOCKED_SURNAMES), as are given names strongly tied to
# them.
GIVEN_F = [
    "Andrea", "Angelica", "Aileen", "Bea", "Camille", "Carmina", "Charmaine", "Cristina", "Danica", "Diane",
    "Divina", "Erlinda", "Frances", "Giselle", "Hazel", "Irene", "Jasmine", "Jennifer", "Joanna", "Jocelyn",
    "Katrina", "Kristine", "Lalaine", "Liezl", "Lorna", "Lovely", "Maricel", "Marjorie", "Melanie", "Michelle",
    "Nerissa", "Nikka", "Patricia", "Pauline", "Precious", "Rachelle", "Rhea", "Rowena", "Sheila", "Stephanie",
    "Theresa", "Trisha", "Vanessa", "Yvonne", "Zenaida", "Ana Marie", "Rosalie", "Joy", "Clarissa", "Mylene",
    "Grace", "Marivic", "Leah", "Kimberly", "Czarina", "Nicole", "Janine", "Ma. Luisa", "Erika", "Rochelle",
]
GIVEN_M = [
    "Adrian", "Alvin", "Arnel", "Benjie", "Carlo", "Christian", "Dennis", "Dominic", "Edgar", "Emmanuel",
    "Enrique", "Francis", "Gerald", "Gilbert", "Jayson", "Jerome", "John Paul", "Jomar", "Jonathan", "Kenneth",
    "Kevin", "Leonardo", "Lorenzo", "Marco", "Mark Anthony", "Michael", "Nathaniel", "Neil", "Noel", "Oliver",
    "Patrick", "Paolo", "Rafael", "Ramil", "Randy", "Raymond", "Renato", "Ricardo", "Rodel", "Rogelio",
    "Romeo", "Ronald", "Ryan", "Samuel", "Vincent", "Wilfredo", "Allan", "Reynaldo", "Arvin", "Elmer",
    "Joel", "Dexter", "Rex", "Jan Carlo", "Ariel", "Glenn", "Harold", "Ismael", "Julius", "Melvin",
]
GIVEN_F_MUSLIM = ["Norhaya", "Sittie Aisah", "Farhana", "Noraida", "Jamila", "Aminah", "Raisa", "Fatimah",
                  "Rohaina", "Asnaira", "Hanifa", "Johaira", "Saima", "Najiya"]
GIVEN_M_MUSLIM = ["Abdulrahman", "Jamal", "Faisal", "Nasser", "Omar", "Ibrahim", "Rashid", "Amir", "Hamid",
                  "Yusop", "Bashir", "Khalid", "Anwar", "Norodin"]

SURNAMES_GENERAL = [
    "Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Villanueva", "Gonzales",
    "Fernandez", "Castillo", "Flores", "De Leon", "Rivera", "Navarro", "Salazar", "Dela Peña", "Domingo",
    "Soriano", "Aguilar", "Mercado", "Ramirez", "Morales", "Pascual", "Santiago", "Valdez", "Castro",
    "Francisco", "Sarmiento", "Ignacio", "Serrano", "Evangelista", "Manalo", "Tolentino", "Samonte",
    "De Guzman", "Lopez", "Panganiban", "Ilagan", "Buenaventura", "Alcantara", "Estrella", "Galang", "Carreon",
    "Sevilla", "Esguerra", "Mangubat", "Dimaculangan", "Resurreccion", "Sanchez", "Del Mundo", "Montemayor",
    "Quiambao", "Bernardo", "Umali", "Delos Santos", "Espiritu", "Macaraeg", "Tan", "Lim", "Go", "Chua", "Uy",
    "Ong", "Co",
]
SURNAMES_REGIONAL = {
    "luzon_north": ["Agcaoili", "Pagaduan", "Rabanal", "Ulep", "Tabios", "Ancheta", "Bumanglag", "Lazo",
                    "Dulnuan", "Tayaban", "Ngalob", "Kimayong", "Aclipen", "Lumbaya", "Bangsoy", "Guzman"],
    "luzon_central": ["Manalang", "Lansangan", "Tuazon", "Sicat", "Yabut", "Dizon", "Gatdula", "Pamintuan"],
    "bicol": ["Bobis", "Nuyda", "Llaguno", "Maravilla", "Oñate", "Cledera", "Abonal", "Bitarra"],
    "visayas": ["Cabahug", "Lapitan", "Ybañez", "Cañete", "Alcoseba", "Montebon", "Sumampong", "Gabutan",
                "Tumulak", "Maglasang", "Gumban", "Sornito", "Jabonete", "Cabardo", "Lagumbay", "Ramada"],
    "mindanao": ["Dagondon", "Bacus", "Sabellano", "Omaña", "Elnas", "Cabrera", "Tabañag", "Lumactod",
                 "Pabualan", "Sagarino"],
    "muslim": ["Abubakar", "Usman", "Kusain", "Guiamal", "Musa", "Salik", "Macaraya", "Dimakuta", "Pangcoga",
               "Tomawis", "Ampaso", "Kamid", "Hadjiali", "Sarip", "Masukat", "Mamalo", "Dalandas"],
}
REGION_NAME_AREA = {
    "NCR": "luzon_central", "CAR": "luzon_north", "I": "luzon_north", "II": "luzon_north",
    "III": "luzon_central", "IV-A": "luzon_central", "IV-B": "luzon_central", "V": "bicol",
    "VI": "visayas", "NIR": "visayas", "VII": "visayas", "VIII": "visayas",
    "IX": "mindanao", "X": "mindanao", "XI": "mindanao", "XII": "mindanao", "XIII": "mindanao",
    "BARMM": "muslim",
}
# Chance that a candidate in a region is given a name from the Muslim pools.
MUSLIM_NAME_SHARE = {"BARMM": 0.7, "IX": 0.2, "X": 0.15, "XII": 0.2}

BLOCKED_SURNAMES = {
    "marcos", "duterte", "aquino", "robredo", "pacquiao", "rizal", "bonifacio", "estrada", "arroyo", "ramos",
    "macapagal", "roxas", "binay", "poe", "sotto", "villar", "cayetano", "pangilinan", "revilla", "recto",
    "enrile", "lacson", "gordon", "tulfo", "romualdez", "magsaysay", "quezon", "osmeña", "laurel", "mabini",
    "aguinaldo", "sison", "ampatuan", "mangudadatu", "dimaporo", "alonto", "adiong", "pangandaman", "pineda",
    "tupas", "cojuangco", "zobel", "ayala", "gokongwei", "sy", "escudero", "gatchalian", "zubiri", "hontiveros",
}
BLOCKED_GIVEN = {"juan", "vilma", "nora", "sharon", "manny", "ninoy", "cory", "leni", "bongbong", "imelda",
                 "rodrigo", "sara", "kris", "ferdinand", "gloria", "joseph", "benigno", "corazon", "fidel",
                 "emilio", "andres", "apolinario", "jericho"}

PHONE_PREFIXES = ["905", "906", "915", "916", "917", "926", "927", "935", "936", "945", "953", "955",
                  "956", "965", "966", "975", "977", "995", "998", "999", "908", "918", "919", "920",
                  "921", "928", "929", "939", "947", "949", "961", "970", "981", "989", "991", "992"]
EMAIL_DOMAINS = ["example.com", "example.org", "example.net"]

TEMPLATE_VARIANTS = [
    "classic_summary_first",
    "skills_first",
    "education_first_graduate",
    "project_heavy",
    "certification_focus",
    "compact_one_page",
    "experienced_professional",
    "experience_first",
    "bullet_heavy",
    "mixed_paragraph",
]
# Layouts that suit each profile (Section 11: match variants to profiles sensibly).
VARIANTS_BY_PROFILE = {
    "strong_entry": ["education_first_graduate", "project_heavy", "skills_first", "compact_one_page",
                     "classic_summary_first", "certification_focus"],
    "partial_entry": ["education_first_graduate", "compact_one_page", "classic_summary_first", "skills_first",
                      "mixed_paragraph", "project_heavy"],
    "strong_mid": ["classic_summary_first", "experience_first", "bullet_heavy", "certification_focus",
                   "skills_first", "mixed_paragraph"],
    "partial_mid": ["classic_summary_first", "experience_first", "compact_one_page", "mixed_paragraph",
                    "bullet_heavy"],
    "advanced": ["experienced_professional", "experience_first", "bullet_heavy", "certification_focus",
                 "mixed_paragraph"],
    "career_transition": ["project_heavy", "skills_first", "certification_focus", "mixed_paragraph",
                          "classic_summary_first"],
    "mixed_boundary": ["classic_summary_first", "experience_first", "skills_first", "mixed_paragraph",
                       "bullet_heavy", "compact_one_page"],
    "cross_category_stress": list(TEMPLATE_VARIANTS[:2]) + ["certification_focus", "experience_first",
                                                             "bullet_heavy", "mixed_paragraph",
                                                             "experienced_professional", "project_heavy"],
}
