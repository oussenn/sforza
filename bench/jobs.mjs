/**
 * Benchmark postings (fictional companies, realistic ads) with gold labels for the master CV.
 *
 * band: the overall score a careful recruiter would give (inclusive range).
 * probes: requirements that must be extracted (matched on the English requirement text) and judged with one
 *         of the accepted verdicts; optional importance/knockout expectations test the extraction.
 */
export const JOBS = [
  {
    id: 'werkstudent-data',
    title: 'Werkstudent (m/w/d) Data Engineering',
    company: 'LogiNord Analytics GmbH',
    band: [70, 95],
    text: `Werkstudent (m/w/d) Data Engineering – Essen (hybrid)
LogiNord Analytics GmbH

Wir sind ein Logistik-Softwareanbieter mit Sitz in Essen-Rüttenscheid. Zum 1. Oktober 2026 suchen wir einen Werkstudenten (m/w/d) für unser Data-Platform-Team (16–20 Std./Woche).

Deine Aufgaben
- Du entwickelst und pflegst ETL-Strecken in Python und SQL, die Daten aus unseren ERP- und Lagerverwaltungssystemen in unser Data Warehouse laden.
- Du baust Dashboards und KPI-Berichte in Power BI für die Fachbereiche.
- Du automatisierst Datenqualitätsprüfungen und dokumentierst Datenflüsse.
- Du unterstützt bei der Anbindung externer Schnittstellen (REST-APIs).

Dein Profil
- Immatrikulierter Student (m/w/d) im Master Data Science, Informatik, Wirtschaftsinformatik oder einem vergleichbaren Studiengang
- Sehr gute Kenntnisse in Python und SQL
- Erste praktische Erfahrung mit ETL-Prozessen und Datenmodellierung
- Erfahrung mit Power BI oder Tableau
- Kenntnisse in Git und Docker sind von Vorteil
- Erfahrung mit Cloud-Plattformen (Azure oder AWS) ist wünschenswert
- Sehr gute Englischkenntnisse; Deutschkenntnisse sind von Vorteil
- Du bist mindestens 2 Tage pro Woche vor Ort in Essen

Wir bieten
- Flexible Arbeitszeiten, die sich deinem Studium anpassen
- 18 € pro Stunde
- Moderne Hardware und ein offenes Team`,
    probes: [
      { match: /enrol|student|immatrikul/i, accept: ['met', 'partial'], knockout: true },
      { match: /python/i, accept: ['met'] },
      { match: /\bsql\b/i, accept: ['met'] },
      { match: /etl/i, accept: ['met', 'partial'] },
      { match: /power ?bi|tableau/i, accept: ['met'] },
      { match: /\bgit\b|docker/i, accept: ['met'], importance: 'nice' },
      { match: /azure|aws|cloud/i, accept: ['partial', 'missing'], importance: 'nice' },
      { match: /english/i, accept: ['met'] },
      { match: /german/i, accept: ['partial', 'met'], importance: 'nice', knockout: false },
      { match: /essen|on.?site|office/i, accept: ['met', 'partial', 'unknown'] },
    ],
  },
  {
    id: 'data-analyst-es',
    title: 'Analista de Datos Junior',
    company: 'Brisa Retail',
    band: [35, 65],
    text: `Analista de Datos Junior – Barcelona (híbrido)
Brisa Retail

Brisa Retail gestiona 85 tiendas de moda en España y Portugal. Buscamos una persona para nuestro equipo de datos comerciales.

Tus funciones
- Preparar datos de ventas y stock con SQL
- Crear y mantener informes en Power BI para los equipos de tienda y de compras
- Analizar campañas y promociones y presentar los resultados
- Revisar la calidad de los datos del CRM

Qué buscamos
- Grado o máster en economía, estadística, ingeniería o similar
- 1 a 3 años de experiencia en análisis de datos
- SQL y Power BI a nivel avanzado
- Python o R para el análisis es un plus
- Español nativo o C1; inglés profesional
- Puesto en Barcelona, 3 días por semana en la oficina

Salario: 30–34 k€ según experiencia.`,
    probes: [
      { match: /(1|one)\D{0,4}(3|three)|years?/i, accept: ['partial', 'met'] },
      { match: /\bsql\b/i, accept: ['met'] },
      { match: /power ?bi/i, accept: ['met'] },
      { match: /python|\br\b/i, accept: ['met'], importance: 'nice' },
      { match: /spanish/i, accept: ['partial', 'missing'] },
      { match: /english/i, accept: ['met'] },
      { match: /degree|master|economics|statistic/i, accept: ['met'] },
      { match: /crm|data quality/i, accept: ['met', 'partial'] },
      { match: /barcelona|office/i, accept: ['partial', 'missing'] },
    ],
  },
  {
    id: 'senior-data-engineer',
    title: 'Senior Data Engineer (m/f/d)',
    company: 'Streamwave Mobility GmbH',
    band: [5, 35],
    text: `Senior Data Engineer (m/f/d) – Berlin
Streamwave Mobility GmbH

About the role
Streamwave operates Europe's largest network of shared e-scooters and processes 2 billion events per day. As a Senior Data Engineer you will own critical parts of our real-time data platform.

What you will do
- Design and operate streaming pipelines with Apache Kafka and Spark Structured Streaming
- Build batch workflows in Airflow and model our lakehouse on Databricks (Delta Lake)
- Run our infrastructure on AWS (S3, EMR, Glue, Lambda) with Terraform
- Mentor mid-level engineers and drive engineering standards

What you bring
- At least 5 years of professional experience as a data engineer
- Expert Python or Scala, excellent SQL
- Deep hands-on experience with Spark and Kafka in production
- Strong AWS experience; Terraform or other infrastructure-as-code
- Experience with dbt is a plus
- Fluent English; German is not required
- Based in Berlin or willing to relocate (visa sponsorship available)`,
    probes: [
      { match: /\b5\b|five/i, accept: ['missing'], knockout: true },
      { match: /spark/i, accept: ['missing'] },
      { match: /kafka/i, accept: ['missing'] },
      { match: /airflow/i, accept: ['missing'] },
      { match: /\baws\b/i, accept: ['missing'] },
      { match: /terraform|infrastructure.as.code/i, accept: ['missing'] },
      { match: /python|scala/i, accept: ['met', 'partial'] },
      { match: /\bsql\b/i, accept: ['met', 'partial'] },
      { match: /\bdbt\b/i, accept: ['missing'], importance: 'nice' },
      { match: /english/i, accept: ['met'] },
    ],
  },
  {
    id: 'werkstudent-sysadmin',
    title: 'Werkstudent (m/w/d) IT-Systemadministration',
    company: 'Stadtwerke Emscher Service GmbH',
    band: [0, 25],
    text: `Werkstudent (m/w/d) IT-Systemadministration
Stadtwerke Emscher Service GmbH – Gelsenkirchen

Für unsere IT-Abteilung am Standort Gelsenkirchen suchen wir ab sofort einen Werkstudenten (m/w/d) mit 20 Stunden pro Woche.

Ihre Aufgaben
- Betreuung und Administration unserer Windows- und Linux-Server
- Pflege der Virtualisierungsumgebung (VMware vSphere, Hyper-V)
- Benutzerverwaltung im Active Directory und in Microsoft 365
- Unterstützung im 2nd-Level-Support für rund 400 Mitarbeitende – telefonisch und vor Ort
- Automatisierung wiederkehrender Aufgaben mit PowerShell

Ihr Profil
- Eingeschriebene/r Student/in der Informatik, Wirtschaftsinformatik oder eines vergleichbaren Studiengangs
- Gute Kenntnisse in Windows Server und Linux
- Grundkenntnisse in Netzwerktechnik (DNS, DHCP, VLAN, Firewall)
- Erfahrung mit Virtualisierung
- Erste Erfahrungen mit PowerShell- oder Bash-Skripten
- Kenntnisse in Active Directory sind von Vorteil
- Verhandlungssichere Deutschkenntnisse (mindestens C1) in Wort und Schrift, da Sie täglich mit unseren Fachabteilungen kommunizieren
- Führerschein Klasse B wünschenswert`,
    probes: [
      { match: /enrol|student|eingeschrieben/i, accept: ['met', 'partial'] },
      { match: /windows|linux/i, accept: ['missing', 'partial'] },
      { match: /dns|dhcp|vlan|firewall|network/i, accept: ['missing'] },
      { match: /virtuali|vmware|hyper-?v/i, accept: ['missing'] },
      { match: /powershell|bash|script/i, accept: ['missing', 'partial'] },
      { match: /active directory/i, accept: ['missing'] },
      { match: /german/i, accept: ['missing', 'partial'], knockout: true },
      { match: /driv|licen[cs]e|führerschein/i, accept: ['unknown', 'missing'], importance: 'nice' },
      { match: /support/i, accept: ['partial', 'met'] },
    ],
  },
  {
    id: 'icu-nurse',
    title: 'Registered Nurse – Intensive Care Unit (ICU)',
    company: 'St. Elisabeth Klinikum Hamburg',
    band: [0, 15],
    text: `Registered Nurse – Intensive Care Unit (ICU)
St. Elisabeth Klinikum Hamburg

Our 24-bed interdisciplinary ICU is looking for a registered nurse to join a team of 60.

Responsibilities
- Provide direct care for ventilated and critically ill patients
- Monitor vital signs, administer medication and manage infusion therapy
- Work with physicians on rounds and document care in our patient record system
- Take part in the 3-shift rotation including weekends

Requirements
- Completed nursing training (Pflegefachfrau/Pflegefachmann) or an equivalent qualification recognised in Germany
- At least 2 years of experience in intensive care
- Valid BLS certification; ACLS is a plus
- German at B2 level or higher (required for professional recognition)
- Experience with ventilation management`,
    probes: [
      { match: /nurs/i, accept: ['missing'], knockout: true },
      { match: /intensive care|\bicu\b/i, accept: ['missing'] },
      { match: /\bbls\b/i, accept: ['missing'] },
      { match: /acls/i, accept: ['missing'], importance: 'nice' },
      { match: /german/i, accept: ['missing'], knockout: true },
      { match: /ventilat/i, accept: ['missing'] },
    ],
  },
  {
    id: 'crm-data-quality',
    title: 'Data Quality Analyst – CRM Migration',
    company: 'Harborline Software GmbH',
    band: [60, 85],
    text: `Data Quality Analyst – CRM Migration (Hamburg or remote in Germany)
Harborline Software GmbH

We are moving 400,000 customer accounts from two legacy CRMs to Salesforce and need help to get the data right.

Your tasks
- Profile, clean and deduplicate customer and contact records
- Write SQL and Python checks for completeness, duplicates and broken references
- Build a Power BI report that tracks data quality during the migration
- Agree matching rules with sales and service teams and document them
- Support test imports and fix rejected records

Your profile
- 2+ years of experience with data analysis or data quality
- Very good SQL; Python for data preparation
- Experience with CRM data; Salesforce is a strong plus
- Experience with a BI tool (Power BI or Tableau)
- Structured documentation
- Very good English; German is a plus`,
    probes: [
      { match: /\b2\b|two/i, accept: ['partial', 'met'], knockout: true },
      { match: /dedup|clean|profil/i, accept: ['met'] },
      { match: /\bsql\b/i, accept: ['met'] },
      { match: /python/i, accept: ['met'] },
      { match: /crm/i, accept: ['met', 'partial'] },
      { match: /salesforce/i, accept: ['missing', 'partial'], importance: 'nice' },
      { match: /power ?bi|tableau|bi tool/i, accept: ['met'] },
      { match: /english/i, accept: ['met'] },
      { match: /german/i, accept: ['partial', 'met'], importance: 'nice', knockout: false },
    ],
  },
  {
    id: 'ml-engineer',
    title: 'Machine Learning Engineer – LLM Platform',
    company: 'Kyra AI GmbH',
    band: [5, 30],
    text: `Machine Learning Engineer – LLM Platform (Munich)
Kyra AI GmbH

We build domain-specific large language models for insurers.

Responsibilities
- Fine-tune and evaluate LLMs (PyTorch, Hugging Face Transformers)
- Build training and inference pipelines on Kubernetes with GPU scheduling
- Own experiment tracking and model registry (MLflow, Weights & Biases)
- Optimise inference latency (vLLM, quantisation)

Requirements
- MSc or PhD in Computer Science, Machine Learning or a related field
- 3+ years of experience deploying machine learning models to production
- Strong PyTorch and deep learning fundamentals
- Experience with Kubernetes and Docker
- Solid Python software engineering (testing, CI/CD)
- Publications at NeurIPS/ICML/ACL are a plus
- English required; German is not needed`,
    probes: [
      { match: /\b3\b|three/i, accept: ['missing'], knockout: true },
      { match: /pytorch|deep learning/i, accept: ['missing'] },
      { match: /kubernetes/i, accept: ['missing', 'partial'] },
      { match: /msc|phd|master|degree/i, accept: ['partial'] },
      { match: /python/i, accept: ['met', 'partial'] },
      { match: /mlflow|weights|experiment tracking/i, accept: ['missing'] },
      { match: /publication|neurips/i, accept: ['missing'], importance: 'nice' },
      { match: /english/i, accept: ['met'] },
    ],
  },
  {
    id: 'bi-analyst',
    title: 'Business Intelligence Analyst (Power BI)',
    company: 'Atlas Retail Group',
    band: [45, 75],
    text: `Business Intelligence Analyst (Power BI) – Vienna (hybrid)
Atlas Retail Group

Atlas Retail Group runs 120 stores across Austria and Germany. Our data team turns sales and supply-chain data into decisions.

Missions
- Build and maintain Power BI dashboards for sales, stock and finance (DAX, Power Query)
- Write SQL to prepare data from our ERP (SAP) and point-of-sale systems
- Define KPIs with business teams and automate weekly reporting
- Ensure data quality and document data models

Profile
- Degree in economics, statistics, computer science or business analytics
- 2+ years of experience in BI or data analysis
- Advanced Power BI (DAX, Power Query) and SQL
- Advanced Excel
- Knowledge of ERP data (SAP) is a plus
- Python for data analysis is a plus
- Fluent German and English
- Based in Vienna, 3 days per week in the office`,
    probes: [
      { match: /\b2\b|two/i, accept: ['partial', 'missing'] },
      { match: /power ?bi|dax/i, accept: ['met', 'partial'] },
      { match: /\bsql\b/i, accept: ['met'] },
      { match: /excel/i, accept: ['met'] },
      { match: /\berp\b|sap/i, accept: ['missing', 'partial'], importance: 'nice' },
      { match: /python/i, accept: ['met'], importance: 'nice' },
      { match: /german/i, accept: ['partial', 'missing'] },
      { match: /english/i, accept: ['met'] },
      { match: /degree|economics|statistic/i, accept: ['met', 'partial'] },
      { match: /vienna|office/i, accept: ['missing', 'partial'] },
    ],
  },
]
