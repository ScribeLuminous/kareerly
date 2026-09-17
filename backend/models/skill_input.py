"""Shared, versioned semantic representation for the skills-first experiment."""
import collections,math,re

EMAIL=re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b')
URL=re.compile(r'https?://\S+|www\.\S+',re.I)
PHONE=re.compile(r'(?<!\w)(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')

def training_idf(job_inventory,skill_ids):
    jobs=[j for j in job_inventory if j['split']=='train']
    freq=collections.Counter(s for j in jobs for s in j['skills'])
    return {s:math.log((1+len(jobs))/(1+freq[s]))+1 for s in skill_ids}

def build_input(text,skills,taxonomy,idf,title=''):
    top=sorted(skills,key=lambda s:-idf[s])[:32]
    skilltext='; '.join(taxonomy.skills[s].label for s in top)
    text=EMAIL.sub('[EMAIL]',PHONE.sub('[PHONE]',URL.sub('[URL]',text)))
    return (f'[ROLE] {title} [SKILLS] {skilltext} [EVIDENCE] '+text[:1400]).strip()
