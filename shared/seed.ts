import { TEMPLATE_MAP } from './templates'
import type { Library, Resume, ResumeContent } from './types'
import { newContact, newSection } from './utils'

/** Fictional sample CV. bench/ tailors and scores it against the postings in bench/jobs.mjs. */
export const masterContent: ResumeContent = {
  personal: {
    name: 'Alex Morgan',
    headline: 'M.Sc. Business Analytics Student · Data Analysis & Reporting',
    contacts: [
      { id: 'c_email', type: 'email', value: 'alex.morgan@example.com', url: 'mailto:alex.morgan@example.com' },
      { id: 'c_phone', type: 'phone', value: '+49 170 0000000', url: 'tel:+491700000000' },
      { id: 'c_location', type: 'location', value: 'Essen, Germany', url: '' },
      { id: 'c_linkedin', type: 'linkedin', value: 'linkedin.com/in/example', url: 'https://linkedin.com/in/example' },
      { id: 'c_github', type: 'github', value: 'github.com/example', url: 'https://github.com/example' },
    ],
  },
  sections: [
    {
      id: 'sec_summary',
      type: 'summary',
      title: 'Profile',
      visible: true,
      placement: 'full',
      text: 'M.Sc. Business Analytics student with two years of part-time work in sales and logistics analytics. Builds SQL data models, Power BI reports and Python analyses on messy business data. English native, German and Spanish at B1.',
    },
    {
      id: 'sec_experience',
      type: 'experience',
      title: 'Professional Experience',
      visible: true,
      placement: 'main',
      items: [
        {
          id: 'exp_sales',
          position: 'Working Student, Sales Analytics',
          company: 'Northwind Traders',
          url: '',
          location: 'Hybrid',
          start: '2025/04',
          end: '',
          current: true,
          description:
            '- Built **Power BI** sales reports for 12 regional managers on a **SQL** data model refreshed every night.\n- Cleaned and matched **80k+ customer records** from two CRM systems before a migration.\n- Automated a weekly margin analysis in **Python (pandas)** that used to take a day in Excel.',
        },
        {
          id: 'exp_logistics',
          position: 'Data Analyst Intern',
          company: 'Contoso Logistics',
          url: '',
          location: 'On-site',
          start: '2024/07',
          end: '2024/12',
          current: false,
          description:
            '- Analysed delivery times for 300 routes in **SQL** and flagged the slowest depots in a **Tableau** dashboard.\n- Wrote data quality checks for shipment data and documented the fixes with the IT team.',
        },
        {
          id: 'exp_research',
          position: 'Research Assistant, Survey Lab',
          company: 'Example University',
          url: '',
          location: 'Hybrid',
          start: '2023/10',
          end: '2024/06',
          current: false,
          description: "- Prepared survey data for four studies in **R** and wrote the descriptive statistics.\n- Kept the lab's data dictionary and codebooks up to date.",
        },
        {
          id: 'exp_cafe',
          position: 'Customer Service Assistant',
          company: 'Fabrikam Coffee',
          url: '',
          location: 'Part-time',
          start: '2021/09',
          end: '2023/06',
          current: false,
          description: '- Handled orders and complaints in English and German, and trained three new colleagues.',
        },
      ],
    },
    {
      id: 'sec_education',
      type: 'education',
      title: 'Education',
      visible: true,
      placement: 'side',
      items: [
        {
          id: 'edu_msc',
          degree: 'M.Sc. Business Analytics',
          school: 'Example Technical University',
          url: '',
          location: 'Germany',
          start: '2024/10',
          end: 'Expected 2026',
          current: false,
          description: '',
        },
        {
          id: 'edu_bsc',
          degree: 'B.Sc. Economics',
          school: 'Example University',
          url: '',
          location: '',
          start: '2020/10',
          end: '2024/09',
          current: false,
          description: '**_Relevant Coursework_:** Econometrics, Statistics, Databases, Marketing Analytics.',
        },
      ],
    },
    {
      id: 'sec_projects',
      type: 'projects',
      title: 'Projects',
      visible: true,
      placement: 'side',
      items: [
        {
          id: 'prj_forecast',
          name: 'Retail Demand Forecast',
          subtitle: '',
          url: '',
          start: '',
          end: '',
          description: 'Weekly demand forecast for 40 stores from two years of sales in Python (scikit-learn); 18% lower error than the naive baseline.',
        },
        {
          id: 'prj_churn',
          name: 'Customer Churn Dashboard',
          subtitle: '',
          url: '',
          start: '',
          end: '',
          description: 'Power BI report that tracks churn by cohort and region, built on a star schema in PostgreSQL.',
        },
        {
          id: 'prj_survey',
          name: 'Survey Text Classifier',
          subtitle: '',
          url: '',
          start: '',
          end: '',
          description: 'Sorted 5,000 open survey answers into topics with a small text classifier in Python.',
        },
      ],
    },
    {
      id: 'sec_languages',
      type: 'languages',
      title: 'Languages',
      visible: true,
      placement: 'side',
      items: [
        { id: 'lang_en', name: 'English', level: 'Native', rating: 5 },
        { id: 'lang_de', name: 'German', level: 'B1', rating: 3 },
        { id: 'lang_es', name: 'Spanish', level: 'B1', rating: 3 },
      ],
    },
    {
      id: 'sec_skills',
      type: 'skills',
      title: 'Technical Skills',
      visible: true,
      placement: 'main',
      items: [
        { id: 'sk_data', name: 'Data & Analytics', details: 'SQL, Python (pandas, NumPy), R, Power BI (DAX, Power Query), Tableau, KPI reporting.', level: 0 },
        { id: 'sk_eng', name: 'Data Engineering', details: 'PostgreSQL, ETL pipelines, data modeling, data cleaning, Git.', level: 0 },
        { id: 'sk_stats', name: 'Statistics', details: 'Regression, forecasting, A/B testing, survey analysis.', level: 0 },
        { id: 'sk_office', name: 'Office', details: 'Advanced Excel, PowerPoint, Jira.', level: 0 },
      ],
    },
    {
      id: 'sec_certs',
      type: 'certifications',
      title: 'Certifications',
      visible: true,
      placement: 'full',
      items: [
        { id: 'cert_pl300', name: 'Power BI Data Analyst (PL-300)', issuer: 'Microsoft', date: '', url: '' },
        { id: 'cert_gda', name: 'Google Data Analytics Certificate', issuer: 'Google', date: '', url: '' },
      ],
    },
  ],
}

/** Empty master CV for a new account: the usual sections, nothing filled in. */
export function blankMaster(id: string, now: string): Resume {
  const types = ['summary', 'experience', 'education', 'projects', 'skills', 'languages', 'certifications'] as const
  return {
    id,
    name: 'Master CV',
    kind: 'master',
    baseId: null,
    isMain: true,
    template: 'signature',
    style: { ...TEMPLATE_MAP.signature.style },
    photo: '',
    sourceLang: 'en',
    content: {
      en: {
        personal: { name: '', headline: '', contacts: [newContact('email'), newContact('phone'), newContact('location')] },
        sections: types.map((type) => newSection(type, 'en', 'signature')),
      },
    },
    translations: {},
    job: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** Fictional sample knowledge base used by bench/: extra material the AI may pick from. */
export const seedLibrary: Library = {
  projects: [
    {
      id: 'lib_reporting',
      name: 'Inventory Reporting Pipeline',
      subtitle: '',
      url: '',
      start: '',
      end: '',
      description: 'Loaded nightly inventory exports into PostgreSQL and built stock-level dashboards; reconciled the counts with the warehouse team.',
    },
  ],
  skills: [
    { id: 'lib_sk_bi', name: 'BI & Visualization', details: 'Power BI (DAX, Power Query), Tableau, matplotlib, plotly', level: 0 },
    { id: 'lib_sk_dm', name: 'Data Management', details: 'PostgreSQL, ETL pipelines, data modeling, data cleaning', level: 0 },
    { id: 'lib_sk_prog', name: 'Programming', details: 'Python (pandas, NumPy, scikit-learn), R, SQL, Git', level: 0 },
    { id: 'lib_sk_office', name: 'Office', details: 'Advanced Excel, PowerPoint', level: 0 },
  ],
  experience: [],
  certifications: [],
  notes: 'Sample notes: results with numbers per job, courses, tools used. The writers may quote these on CVs and letters.',
}
