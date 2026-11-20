---
layout: archive
title: "CV"
permalink: /cv/
author_profile: true
redirect_from:
  - /resume
---

{% include base_path %}

[Download my CV as a PDF]({{ base_path }}/files/CV.pdf){: .btn .btn--info}

Education
======
* **PhD (Candidate), Biochemistry and Molecular Biology**, University of Calgary, 2021–2026
  * Supervisor: Prof. A.P. Jason de Koning
* **MSc, Computer Science**, Queen’s University, 2019–2021
  * Thesis: [Nondeterministic State Complexity of Site-Directed Operations]({{ base_path }}/publication/2021-thesis)
  * Supervisor: Prof. Kai Salomaa
* **BSc (High Honours), Computer Science (Major), Mathematics (Minor)**, University of Saskatchewan, 2014–2019
  * Thesis: [Lindenmayer Systems - Inferring Branching Topology]({{ base_path }}/publication/2019-thesis)
  * Honours supervisor: Prof. Ian McQuillan

Professional experience
======
* **Graduate Teaching Assistant**, Cumming School of Medicine, University of Calgary, 2024–2025
  * AI Applications in Health
  * Interdisciplinary Approaches to Research: Research Ethics
* **Graduate Teaching Assistant**, School of Computing, Queen’s University, 2019–2020
  * Image Processing and Computer Vision
  * Social, Ethical and Legal Issues in Computing
* **Undergraduate Summer Research**, Bioinformatics Lab, University of Saskatchewan, 2019
  * Supervisor: Prof. Ian McQuillan
* **Undergraduate Summer Research**, Department of Pathology and Laboratory Medicine, University of California Davis, 2018
  * Supervisor: Prof. Nam K. Tran
* **Undergraduate Summer Research**, Numerical Simulation Research Lab, University of Saskatchewan, 2016
  * Supervisor: Prof. Raymond Spiteri

Awards and distinctions
======
* **MDBC Program Travel Award**, Department of Biochemistry and Molecular Biology, University of Calgary, 2025–2026 ($500 CAD)
* **ACHRI Travel Award**, Alberta Children’s Hospital Research Institute, 2025–2026 ($500 CAD)
* **U of C Board of Governors Graduate Scholarship**, Open Scholarship Competition (Doctoral), University of Calgary, 2023–2026 ($38,000 CAD)
* **MDBC Program Travel Award**, Department of Biochemistry and Molecular Biology, University of Calgary, 2023–2024 ($1,000 CAD)
* **ACHRI Graduate Scholarship**, Alberta Children’s Hospital Research Institute, 2022–2024 ($34,000 CAD)
* **Donald Knuth Reward Check**, Donald E. Knuth, Stanford University, 2020 ($2.56 USD)
* **Departmental Undergraduate Student Research Award**, Department of Computing, University of Saskatchewan, 2019 ($8,000 CAD)
* **Academy Distinguished Abstract Award**, AACC (now ADLM) Annual Meeting, 2018 ($500 USD)
* **Best Abstract Award, Hematology & Coagulation Division**, AACC (now ADLM) Annual Meeting, 2017 ($500 USD)

Publications
======
  <ul>{% for post in site.publications reversed %}
    {% include archive-single-cv.html %}
  {% endfor %}</ul>

{% if site.data.manuscripts %}
Submitted and in preparation
------
<ul>
{% for item in site.data.manuscripts %}
  <li>{{ item.authors }} <i>{{ item.title }}.</i> {{ item.status }}, {{ item.year }}.</li>
{% endfor %}
</ul>
{% endif %}

Talks and posters
======
  <ul>{% for post in site.talks reversed %}
    {% include archive-single-talk-cv.html %}
  {% endfor %}</ul>

Teaching
======
  <ul>{% for post in site.teaching reversed %}
    {% include archive-single-cv.html %}
  {% endfor %}</ul>

Professional memberships and activities
======
* **Peer Reviewer**, npj Digital Medicine, 2026
* **Focus on Peer Review certificate**, Nature, 2026
* **Peer Reviewer**, International Conference on Descriptional Complexity of Formal Systems, 2025
* **Graduate Teaching Certificate**, Taylor Institute for Teaching and Learning, University of Calgary, 2025
* **Member**, Society for Molecular Biology and Evolution, 2023–2026
* **Peer Reviewer**, The Journal of Applied Laboratory Medicine, 2022–2024
* **Social Officer and MSc Graduate Committee Officer**, Graduate Computing Society, Queen’s University, 2019–2020
* **Vice President External**, Physics and Engineering Physics Students’ Society, University of Saskatchewan, 2015–2016

Other
======
* ORCID: [0000-0002-9693-8815](https://orcid.org/0000-0002-9693-8815)
* Erdős number: 4
* Bank of San Serriffe: 0x$1.00
